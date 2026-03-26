import type { PointerEvent as ReactPointerEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { withApiRoot } from '../lib/api'
import { clamp, clampGeometry, draftBlockKey, type DraftBlock } from '../lib/segmentation'
import type { BlockGeometry, PageResponse } from '../lib/types'

type ActiveTool = 'select' | 'create'
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export type CanvasViewMode = 'fit-page' | 'fit-width' | 'manual'

export interface CanvasViewportState {
  zoom: number
  mode: CanvasViewMode
  panX: number
  panY: number
}

export interface DocumentCanvasHandle {
  fitPage: () => void
  fitWidth: () => void
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
}

type InteractionState =
  | {
      kind: 'create'
      pointerId: number
      start: { x: number; y: number }
      current: { x: number; y: number }
    }
  | {
      kind: 'move'
      pointerId: number
      blockId: string
      start: { x: number; y: number }
      initial: BlockGeometry
    }
  | {
      kind: 'resize'
      pointerId: number
      blockId: string
      start: { x: number; y: number }
      handle: ResizeHandle
      initial: BlockGeometry
    }

interface DocumentCanvasProps {
  page: PageResponse
  blocks: DraftBlock[]
  selectedBlockId: string | null
  activeTool: ActiveTool
  isLocked: boolean
  onViewportChange: (viewport: CanvasViewportState) => void
  onSelectBlock: (blockId: string) => void
  onCreateBlock: (geometry: BlockGeometry) => void
  onUpdateBlockGeometry: (blockId: string, geometry: BlockGeometry) => void
}

const MIN_SIZE = 0.02
const MIN_ZOOM = 0.35
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2
const resizeHandles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function normalizeGeometry(start: { x: number; y: number }, end: { x: number; y: number }): BlockGeometry {
  const x = clamp(Math.min(start.x, end.x))
  const y = clamp(Math.min(start.y, end.y))
  const width = clamp(Math.abs(end.x - start.x), MIN_SIZE, 1 - x)
  const height = clamp(Math.abs(end.y - start.y), MIN_SIZE, 1 - y)
  return { x, y, width, height }
}

function pointerToRelative(
  event: PointerEvent | ReactPointerEvent<HTMLElement>,
  target: HTMLElement,
): { x: number; y: number } {
  const rect = target.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  }
}

function resizeGeometry(
  geometry: BlockGeometry,
  handle: ResizeHandle,
  point: { x: number; y: number },
): BlockGeometry {
  const left = geometry.x
  const top = geometry.y
  const right = geometry.x + geometry.width
  const bottom = geometry.y + geometry.height

  let nextLeft = left
  let nextTop = top
  let nextRight = right
  let nextBottom = bottom

  if (handle.includes('w')) {
    nextLeft = clamp(point.x, 0, right - MIN_SIZE)
  }
  if (handle.includes('e')) {
    nextRight = clamp(point.x, left + MIN_SIZE, 1)
  }
  if (handle.includes('n')) {
    nextTop = clamp(point.y, 0, bottom - MIN_SIZE)
  }
  if (handle.includes('s')) {
    nextBottom = clamp(point.y, top + MIN_SIZE, 1)
  }

  return clampGeometry({
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  })
}

export const DocumentCanvas = forwardRef<DocumentCanvasHandle, DocumentCanvasProps>(function DocumentCanvas(
  {
    page,
    blocks,
    selectedBlockId,
    activeTool,
    isLocked,
    onViewportChange,
    onSelectBlock,
    onCreateBlock,
    onUpdateBlockGeometry,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [interaction, setInteraction] = useState<InteractionState | null>(null)
  const [viewport, setViewport] = useState<CanvasViewportState>({
    zoom: 1,
    mode: 'fit-page',
    panX: 0,
    panY: 0,
  })
  const [spacePressed, setSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)
  const panStateRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(
    null,
  )

  function syncViewport(nextViewport: CanvasViewportState, resetPan = false) {
    const viewportElement = viewportRef.current
    if (!viewportElement) {
      setViewport(nextViewport)
      return
    }

    const panX = resetPan ? 0 : Math.max(0, Math.min(nextViewport.panX, viewportElement.scrollWidth))
    const panY = resetPan ? 0 : Math.max(0, Math.min(nextViewport.panY, viewportElement.scrollHeight))
    viewportElement.scrollLeft = panX
    viewportElement.scrollTop = panY
    setViewport({ ...nextViewport, panX, panY })
  }

  function computeFitZoom(mode: Exclude<CanvasViewMode, 'manual'>) {
    const viewportElement = viewportRef.current
    if (!viewportElement) {
      return 1
    }
    const widthZoom = viewportElement.clientWidth / page.width
    const heightZoom = viewportElement.clientHeight / page.height
    const nextZoom = mode === 'fit-width' ? widthZoom : Math.min(widthZoom, heightZoom)
    return clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  }

  function applyViewMode(mode: Exclude<CanvasViewMode, 'manual'>) {
    const nextZoom = computeFitZoom(mode)
    syncViewport({ zoom: nextZoom, mode, panX: 0, panY: 0 }, true)
  }

  function applyManualZoom(zoom: number) {
    syncViewport({ zoom: clamp(zoom, MIN_ZOOM, MAX_ZOOM), mode: 'manual', panX: viewport.panX, panY: viewport.panY })
  }

  useImperativeHandle(ref, () => ({
    fitPage: () => applyViewMode('fit-page'),
    fitWidth: () => applyViewMode('fit-width'),
    resetZoom: () => syncViewport({ zoom: 1, mode: 'manual', panX: 0, panY: 0 }, true),
    zoomIn: () => applyManualZoom(viewport.zoom + ZOOM_STEP),
    zoomOut: () => applyManualZoom(viewport.zoom - ZOOM_STEP),
  }))

  useEffect(() => {
    applyViewMode('fit-page')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  useEffect(() => {
    onViewportChange(viewport)
  }, [onViewportChange, viewport])

  useEffect(() => {
    const viewportElement = viewportRef.current
    if (!viewportElement || typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(() => {
      setViewport((current) => {
        if (current.mode === 'manual') {
          return current
        }
        const nextZoom = computeFitZoom(current.mode)
        const nextViewport: CanvasViewportState = { zoom: nextZoom, mode: current.mode, panX: 0, panY: 0 }
        viewportElement.scrollLeft = 0
        viewportElement.scrollTop = 0
        return nextViewport
      })
    })

    observer.observe(viewportElement)
    return () => {
      observer.disconnect()
    }
  }, [onViewportChange, page.height, page.width])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePressed(true)
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') {
        setSpacePressed(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    if (!interaction || isLocked) {
      return undefined
    }
    const currentInteraction = interaction

    function handlePointerMove(event: PointerEvent) {
      if (!surfaceRef.current) {
        return
      }
      const point = pointerToRelative(event, surfaceRef.current)

      if (currentInteraction.pointerId !== event.pointerId) {
        return
      }

      if (currentInteraction.kind === 'create') {
        setInteraction({
          kind: 'create',
          pointerId: currentInteraction.pointerId,
          start: currentInteraction.start,
          current: point,
        })
        return
      }

      if (currentInteraction.kind === 'move') {
        const deltaX = point.x - currentInteraction.start.x
        const deltaY = point.y - currentInteraction.start.y
        onUpdateBlockGeometry(
          currentInteraction.blockId,
          clampGeometry({
            ...currentInteraction.initial,
            x: currentInteraction.initial.x + deltaX,
            y: currentInteraction.initial.y + deltaY,
          }),
        )
        return
      }

      onUpdateBlockGeometry(
        currentInteraction.blockId,
        resizeGeometry(currentInteraction.initial, currentInteraction.handle, point),
      )
    }

    function handlePointerUp(event: PointerEvent) {
      if (currentInteraction.pointerId !== event.pointerId) {
        return
      }
      if (currentInteraction.kind === 'create') {
        const geometry = normalizeGeometry(currentInteraction.start, currentInteraction.current)
        if (geometry.width >= MIN_SIZE && geometry.height >= MIN_SIZE) {
          onCreateBlock(geometry)
        }
      }
      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [interaction, isLocked, onCreateBlock, onUpdateBlockGeometry])

  useEffect(() => {
    if (!isPanning) {
      return undefined
    }

    function handlePointerMove(event: PointerEvent) {
      const viewportElement = viewportRef.current
      const panState = panStateRef.current
      if (!viewportElement || !panState || panState.pointerId !== event.pointerId) {
        return
      }

      viewportElement.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX)
      viewportElement.scrollTop = panState.scrollTop - (event.clientY - panState.startY)
      setViewport({
        ...viewport,
        panX: viewportElement.scrollLeft,
        panY: viewportElement.scrollTop,
      })
    }

    function handlePointerUp(event: PointerEvent) {
      const panState = panStateRef.current
      if (!panState || panState.pointerId !== event.pointerId) {
        return
      }
      panStateRef.current = null
      setIsPanning(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isPanning, onViewportChange, viewport])

  const draftGeometry =
    interaction?.kind === 'create' ? normalizeGeometry(interaction.start, interaction.current) : null

  return (
    <section className="canvas-panel canvas-panel-embedded">
      <div
        className={`canvas-viewport ${isPanning ? 'canvas-viewport-panning' : ''}`}
        ref={viewportRef}
        onScroll={(event) => {
          setViewport({
            ...viewport,
            panX: event.currentTarget.scrollLeft,
            panY: event.currentTarget.scrollTop,
          })
        }}
        onPointerDown={(event) => {
          if (!(spacePressed || event.button === 1) || viewport.zoom <= 1) {
            return
          }
        }}
      >
        <div
          className={`canvas-frame ${activeTool === 'create' && !isLocked ? 'canvas-frame-draw' : ''}`}
          ref={surfaceRef}
          style={{
            width: `${page.width * viewport.zoom}px`,
            height: `${page.height * viewport.zoom}px`,
          }}
          onPointerDown={(event) => {
            if (spacePressed || event.button === 1 || isLocked || activeTool !== 'create') {
              if (spacePressed || event.button === 1) {
                event.preventDefault()
                panStateRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  scrollLeft: viewportRef.current?.scrollLeft ?? 0,
                  scrollTop: viewportRef.current?.scrollTop ?? 0,
                }
                setIsPanning(true)
              }
              return
            }
            const point = pointerToRelative(event, event.currentTarget)
            setInteraction({ kind: 'create', pointerId: event.pointerId, start: point, current: point })
          }}
        >
          <img className="canvas-image" src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
          {blocks.map((block) => {
            const blockId = draftBlockKey(block)
            const isSelected = blockId === selectedBlockId
            return (
              <div
                key={blockId}
                className={`region region-${block.block_type} ${isSelected ? 'region-selected' : ''}`}
                style={{
                  left: `${block.geometry.x * 100}%`,
                  top: `${block.geometry.y * 100}%`,
                  width: `${block.geometry.width * 100}%`,
                  height: `${block.geometry.height * 100}%`,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onSelectBlock(blockId)
                  if (spacePressed || event.button === 1) {
                    event.preventDefault()
                    panStateRef.current = {
                      pointerId: event.pointerId,
                      startX: event.clientX,
                      startY: event.clientY,
                      scrollLeft: viewportRef.current?.scrollLeft ?? 0,
                      scrollTop: viewportRef.current?.scrollTop ?? 0,
                    }
                    setIsPanning(true)
                    return
                  }
                  if (isLocked || activeTool !== 'select' || !surfaceRef.current) {
                    return
                  }
                  setInteraction({
                    kind: 'move',
                    pointerId: event.pointerId,
                    blockId,
                    start: pointerToRelative(event, surfaceRef.current),
                    initial: block.geometry,
                  })
                }}
              >
                <span className="region-label">
                  {block.block_type}
                  <strong>#{block.order_index + 1}</strong>
                </span>
                {isSelected && !isLocked
                  ? resizeHandles.map((handle) => (
                      <span
                        key={handle}
                        className={`region-handle region-handle-${handle}`}
                        onPointerDown={(event) => {
                          if (!surfaceRef.current) {
                            return
                          }
                          event.preventDefault()
                          event.stopPropagation()
                          setInteraction({
                            kind: 'resize',
                            pointerId: event.pointerId,
                            blockId,
                            handle,
                            start: pointerToRelative(event, surfaceRef.current),
                            initial: block.geometry,
                          })
                        }}
                      />
                    ))
                  : null}
              </div>
            )
          })}
          {draftGeometry ? (
            <div
              className="region region-draft"
              style={{
                left: `${draftGeometry.x * 100}%`,
                top: `${draftGeometry.y * 100}%`,
                width: `${draftGeometry.width * 100}%`,
                height: `${draftGeometry.height * 100}%`,
              }}
            />
          ) : null}
        </div>
      </div>
    </section>
  )
})
