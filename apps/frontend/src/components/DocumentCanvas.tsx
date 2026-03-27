import type { PointerEvent as ReactPointerEvent } from 'react'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { CanvasTooltip } from './CanvasTooltip'
import { EditorToolbar, type EditorToolbarProps } from './EditorToolbar'
import { withApiRoot } from '../lib/api'
import {
  clamp,
  clampGeometry,
  clampVertex,
  draftBlockKey,
  geometryFromVertices,
  isPolygonBlock,
  translateVertices,
  type DraftBlock,
} from '../lib/segmentation'
import type { BlockGeometry, BlockShapeType, BlockVertex, PageResponse } from '../lib/types'

type ActiveTool = 'select' | 'rect' | 'freeform'
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasPoint = { x: number; y: number }

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
      kind: 'rect-create'
      pointerId: number
      start: CanvasPoint
      current: CanvasPoint
    }
  | {
      kind: 'freeform-create'
      pointerId: number
      points: CanvasPoint[]
      current: CanvasPoint
    }
  | {
      kind: 'move'
      pointerId: number
      blockId: string
      start: CanvasPoint
      initialGeometry: BlockGeometry
      initialVertices: BlockVertex[] | null
    }
  | {
      kind: 'resize'
      pointerId: number
      blockId: string
      start: CanvasPoint
      handle: ResizeHandle
      initial: BlockGeometry
    }
  | {
      kind: 'vertex'
      pointerId: number
      blockId: string
      vertexIndex: number
      initialVertices: BlockVertex[]
    }

interface DocumentCanvasProps {
  page: PageResponse
  blocks: DraftBlock[]
  toolbar: EditorToolbarProps
  toast?: {
    tone: 'saving' | 'success' | 'error'
    message: string
  } | null
  tooltipLabel: string
  tooltipText: string
  selectedBlockId: string | null
  activeTool: ActiveTool
  isLocked: boolean
  onViewportChange: (viewport: CanvasViewportState) => void
  onSelectBlock: (blockId: string | null) => void
  onCreateBlock: (payload: { shape_type: BlockShapeType; geometry: BlockGeometry; vertices: BlockVertex[] | null }) => void
  onUpdateBlock: (blockId: string, payload: { geometry: BlockGeometry; vertices: BlockVertex[] | null }) => void
}

const MIN_SIZE = 0.02
const MIN_ZOOM = 0.35
const MAX_ZOOM = 4
const ZOOM_STEP = 0.2
const FREEFORM_DRAW_STEP = 0.0015
const POINT_EPSILON = 0.002
const FREEFORM_SIMPLIFY_EPSILON = 0.005
const resizeHandles: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

function normalizeGeometry(start: CanvasPoint, end: CanvasPoint): BlockGeometry {
  const x = clamp(Math.min(start.x, end.x))
  const y = clamp(Math.min(start.y, end.y))
  const width = clamp(Math.abs(end.x - start.x), MIN_SIZE, 1 - x)
  const height = clamp(Math.abs(end.y - start.y), MIN_SIZE, 1 - y)
  return { x, y, width, height }
}

function pointerToRelative(
  event: PointerEvent | ReactPointerEvent<HTMLElement>,
  target: HTMLElement,
): CanvasPoint {
  const rect = target.getBoundingClientRect()
  return {
    x: clamp((event.clientX - rect.left) / rect.width),
    y: clamp((event.clientY - rect.top) / rect.height),
  }
}

function resizeGeometry(
  geometry: BlockGeometry,
  handle: ResizeHandle,
  point: CanvasPoint,
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

function distanceBetween(a: CanvasPoint, b: CanvasPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointsAreNear(a: CanvasPoint, b: CanvasPoint) {
  return distanceBetween(a, b) <= POINT_EPSILON
}

function distanceToSegment(point: CanvasPoint, start: CanvasPoint, end: CanvasPoint) {
  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  if (Math.abs(deltaX) <= Number.EPSILON && Math.abs(deltaY) <= Number.EPSILON) {
    return distanceBetween(point, start)
  }

  const projection = ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / (deltaX * deltaX + deltaY * deltaY)
  const clampedProjection = clamp(projection)
  const projectedPoint = {
    x: start.x + clampedProjection * deltaX,
    y: start.y + clampedProjection * deltaY,
  }
  return distanceBetween(point, projectedPoint)
}

function simplifyFreeformVertices(vertices: BlockVertex[]): BlockVertex[] {
  if (vertices.length <= 3) {
    return vertices
  }

  const simplified = [...vertices]
  let changed = true
  while (changed && simplified.length > 3) {
    changed = false
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length]
      const current = simplified[index]
      const next = simplified[(index + 1) % simplified.length]
      if (
        pointsAreNear(previous, current) ||
        pointsAreNear(current, next) ||
        distanceToSegment(current, previous, next) > FREEFORM_SIMPLIFY_EPSILON
      ) {
        continue
      }
      simplified.splice(index, 1)
      changed = true
      break
    }
  }
  return simplified
}

function buildDraftFreeformVertices(points: CanvasPoint[], current: CanvasPoint): BlockVertex[] {
  const deduped = points.reduce<CanvasPoint[]>((accumulator, point) => {
    if (accumulator.length === 0 || !pointsAreNear(accumulator[accumulator.length - 1], point)) {
      accumulator.push(clampVertex(point))
    }
    return accumulator
  }, [])

  if (deduped.length === 0 || !pointsAreNear(deduped[deduped.length - 1], current)) {
    deduped.push(clampVertex(current))
  }

  if (deduped.length > 1 && pointsAreNear(deduped[0], deduped[deduped.length - 1])) {
    deduped.pop()
  }

  return deduped
}

function finalizeFreeformVertices(points: CanvasPoint[], current: CanvasPoint): BlockVertex[] {
  const draftVertices = buildDraftFreeformVertices(points, current)
  const simplifiedVertices = simplifyFreeformVertices(draftVertices)
  return isValidPolygon(simplifiedVertices) ? simplifiedVertices : draftVertices
}

function maybeAppendPoint(points: CanvasPoint[], current: CanvasPoint): CanvasPoint[] {
  if (points.length === 0 || distanceBetween(points[points.length - 1], current) >= FREEFORM_DRAW_STEP) {
    return [...points, current]
  }
  return points
}

function orientation(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
  if (Math.abs(value) <= Number.EPSILON) {
    return 0
  }
  return value > 0 ? 1 : 2
}

function onSegment(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint) {
  return (
    Math.min(a.x, c.x) - Number.EPSILON <= b.x &&
    b.x <= Math.max(a.x, c.x) + Number.EPSILON &&
    Math.min(a.y, c.y) - Number.EPSILON <= b.y &&
    b.y <= Math.max(a.y, c.y) + Number.EPSILON
  )
}

function segmentsIntersect(a: CanvasPoint, b: CanvasPoint, c: CanvasPoint, d: CanvasPoint) {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)

  if (first !== second && third !== fourth) {
    return true
  }
  if (first === 0 && onSegment(a, c, b)) {
    return true
  }
  if (second === 0 && onSegment(a, d, b)) {
    return true
  }
  if (third === 0 && onSegment(c, a, d)) {
    return true
  }
  if (fourth === 0 && onSegment(c, b, d)) {
    return true
  }
  return false
}

function isSelfIntersectingPolygon(vertices: BlockVertex[]) {
  const totalSegments = vertices.length
  for (let index = 0; index < totalSegments; index += 1) {
    const firstStart = vertices[index]
    const firstEnd = vertices[(index + 1) % totalSegments]
    for (let compareIndex = index + 1; compareIndex < totalSegments; compareIndex += 1) {
      const areAdjacent =
        compareIndex === index ||
        compareIndex === index + 1 ||
        (index === 0 && compareIndex === totalSegments - 1)
      if (areAdjacent) {
        continue
      }
      const secondStart = vertices[compareIndex]
      const secondEnd = vertices[(compareIndex + 1) % totalSegments]
      if (segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd)) {
        return true
      }
    }
  }
  return false
}

function isValidPolygon(vertices: BlockVertex[]) {
  if (vertices.length < 3) {
    return false
  }
  const geometry = geometryFromVertices(vertices)
  return geometry.width >= MIN_SIZE && geometry.height >= MIN_SIZE && !isSelfIntersectingPolygon(vertices)
}

function pointInPolygon(point: CanvasPoint, vertices: BlockVertex[]) {
  let inside = false
  for (let index = 0, previousIndex = vertices.length - 1; index < vertices.length; previousIndex = index, index += 1) {
    const current = vertices[index]
    const previous = vertices[previousIndex]
    const intersects =
      current.y > point.y !== previous.y > point.y &&
      point.x < ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x
    if (intersects) {
      inside = !inside
    }
  }
  return inside
}

function clampMoveDelta(geometry: BlockGeometry, deltaX: number, deltaY: number) {
  return {
    x: clamp(deltaX, -geometry.x, 1 - (geometry.x + geometry.width)),
    y: clamp(deltaY, -geometry.y, 1 - (geometry.y + geometry.height)),
  }
}

function polygonPointsToLocalString(block: DraftBlock) {
  if (!block.vertices || block.geometry.width <= 0 || block.geometry.height <= 0) {
    return ''
  }
  return block.vertices
    .map((vertex) => {
      const x = ((vertex.x - block.geometry.x) / block.geometry.width) * 100
      const y = ((vertex.y - block.geometry.y) / block.geometry.height) * 100
      return `${x},${y}`
    })
    .join(' ')
}

function polygonPointsToCanvasString(points: CanvasPoint[]) {
  return points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')
}

export const DocumentCanvas = forwardRef<DocumentCanvasHandle, DocumentCanvasProps>(function DocumentCanvas(
  {
    page,
    blocks,
    toolbar,
    toast,
    tooltipLabel,
    tooltipText,
    selectedBlockId,
    activeTool,
    isLocked,
    onViewportChange,
    onSelectBlock,
    onCreateBlock,
    onUpdateBlock,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [interaction, setInteraction] = useState<InteractionState | null>(null)
  const [localToast, setLocalToast] = useState<DocumentCanvasProps['toast']>(null)
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

  function showCanvasToast(nextToast: NonNullable<DocumentCanvasProps['toast']>) {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current)
    }
    setLocalToast(nextToast)
    toastTimeoutRef.current = window.setTimeout(() => {
      setLocalToast(null)
      toastTimeoutRef.current = null
    }, 2200)
  }

  function startPanning(event: ReactPointerEvent<HTMLDivElement>) {
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
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!interaction || isLocked) {
      return undefined
    }
    const currentInteraction = interaction

    function handlePointerMove(event: PointerEvent) {
      if (!surfaceRef.current || currentInteraction.pointerId !== event.pointerId) {
        return
      }
      const point = pointerToRelative(event, surfaceRef.current)

      if (currentInteraction.kind === 'rect-create') {
        setInteraction({
          kind: 'rect-create',
          pointerId: currentInteraction.pointerId,
          start: currentInteraction.start,
          current: point,
        })
        return
      }

      if (currentInteraction.kind === 'freeform-create') {
        setInteraction({
          kind: 'freeform-create',
          pointerId: currentInteraction.pointerId,
          points: maybeAppendPoint(currentInteraction.points, point),
          current: point,
        })
        return
      }

      if (currentInteraction.kind === 'move') {
        const delta = clampMoveDelta(
          currentInteraction.initialGeometry,
          point.x - currentInteraction.start.x,
          point.y - currentInteraction.start.y,
        )
        if (currentInteraction.initialVertices) {
          const vertices = translateVertices(currentInteraction.initialVertices, delta.x, delta.y)
          onUpdateBlock(currentInteraction.blockId, {
            vertices,
            geometry: geometryFromVertices(vertices),
          })
          return
        }
        onUpdateBlock(currentInteraction.blockId, {
          vertices: null,
          geometry: clampGeometry({
            ...currentInteraction.initialGeometry,
            x: currentInteraction.initialGeometry.x + delta.x,
            y: currentInteraction.initialGeometry.y + delta.y,
          }),
        })
        return
      }

      if (currentInteraction.kind === 'resize') {
        onUpdateBlock(currentInteraction.blockId, {
          vertices: null,
          geometry: resizeGeometry(currentInteraction.initial, currentInteraction.handle, point),
        })
        return
      }

      const vertices = currentInteraction.initialVertices.map((vertex, index) =>
        index === currentInteraction.vertexIndex ? clampVertex(point) : vertex,
      )
      onUpdateBlock(currentInteraction.blockId, {
        vertices,
        geometry: geometryFromVertices(vertices),
      })
    }

    function handlePointerUp(event: PointerEvent) {
      if (currentInteraction.pointerId !== event.pointerId) {
        return
      }

      if (currentInteraction.kind === 'rect-create') {
        const geometry = normalizeGeometry(currentInteraction.start, currentInteraction.current)
        if (geometry.width >= MIN_SIZE && geometry.height >= MIN_SIZE) {
          onCreateBlock({ shape_type: 'rect', geometry, vertices: null })
        }
      }

      if (currentInteraction.kind === 'freeform-create') {
        const vertices = finalizeFreeformVertices(currentInteraction.points, currentInteraction.current)
        if (!isValidPolygon(vertices)) {
          showCanvasToast({ tone: 'error', message: 'Ignored invalid free-form path.' })
          setInteraction(null)
          return
        }
        onCreateBlock({
          shape_type: 'polygon',
          geometry: geometryFromVertices(vertices),
          vertices,
        })
      }

      if (currentInteraction.kind === 'vertex') {
        const nextBlock = blocks.find((block) => draftBlockKey(block) === currentInteraction.blockId)
        if (!nextBlock || !nextBlock.vertices || isValidPolygon(nextBlock.vertices)) {
          setInteraction(null)
          return
        }
        onUpdateBlock(currentInteraction.blockId, {
          vertices: currentInteraction.initialVertices,
          geometry: geometryFromVertices(currentInteraction.initialVertices),
        })
        showCanvasToast({ tone: 'error', message: 'Ignored invalid polygon edit.' })
      }

      setInteraction(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [blocks, interaction, isLocked, onCreateBlock, onUpdateBlock])

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

  const draftRectGeometry =
    interaction?.kind === 'rect-create' ? normalizeGeometry(interaction.start, interaction.current) : null
  const draftFreeformPoints =
    interaction?.kind === 'freeform-create' ? buildDraftFreeformVertices(interaction.points, interaction.current) : null
  const activeToast = toast ?? localToast

  return (
    <section className="canvas-panel canvas-panel-embedded">
      <div className="canvas-stage">
        <div className="canvas-overlay-stack">
          <EditorToolbar {...toolbar} />
          <CanvasTooltip label={tooltipLabel} message={tooltipText} />
        </div>
        {activeToast ? (
          <div
            className={`canvas-toast canvas-toast-${activeToast.tone}`}
            role={activeToast.tone === 'error' ? 'alert' : 'status'}
            aria-live={activeToast.tone === 'error' ? 'assertive' : 'polite'}
          >
            {activeToast.message}
          </div>
        ) : null}

        <div
          className={`canvas-viewport ${isPanning ? 'canvas-viewport-panning' : ''}`}
          ref={viewportRef}
          onContextMenu={(event) => {
            event.preventDefault()
          }}
          onScroll={(event) => {
            setViewport({
              ...viewport,
              panX: event.currentTarget.scrollLeft,
              panY: event.currentTarget.scrollTop,
            })
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) {
              return
            }
            if (spacePressed || event.button === 1) {
              if (viewport.zoom > 1) {
                startPanning(event)
              }
              return
            }
            if (event.button === 0 && (isLocked || activeTool === 'select')) {
              onSelectBlock(null)
            }
          }}
        >
          <div
            className={`canvas-frame ${activeTool !== 'select' && !isLocked ? 'canvas-frame-draw' : ''}`}
            ref={surfaceRef}
            style={{
              width: `${page.width * viewport.zoom}px`,
              height: `${page.height * viewport.zoom}px`,
            }}
            onPointerDown={(event) => {
              if (spacePressed || event.button === 1) {
                startPanning(event)
                return
              }
              if (isLocked || activeTool === 'select') {
                if (event.button === 0) {
                  onSelectBlock(null)
                }
                return
              }
              const point = pointerToRelative(event, event.currentTarget)
              if (activeTool === 'rect') {
                setInteraction({ kind: 'rect-create', pointerId: event.pointerId, start: point, current: point })
                return
              }
              setInteraction({
                kind: 'freeform-create',
                pointerId: event.pointerId,
                points: [point],
                current: point,
              })
            }}
          >
            <img className="canvas-image" src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
            {blocks.map((block) => {
              const blockId = draftBlockKey(block)
              const isSelected = blockId === selectedBlockId
              const commonStyle = {
                left: `${block.geometry.x * 100}%`,
                top: `${block.geometry.y * 100}%`,
                width: `${block.geometry.width * 100}%`,
                height: `${block.geometry.height * 100}%`,
              }

              if (isPolygonBlock(block) && block.vertices) {
                const polygonVertices = block.vertices
                return (
                  <div
                    key={blockId}
                    className={`region region-${block.block_type} region-polygon ${isSelected ? 'region-selected' : ''}`}
                    style={commonStyle}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      onSelectBlock(blockId)
                      if (spacePressed || event.button === 1) {
                        startPanning(event)
                        return
                      }
                      if (isLocked || activeTool !== 'select' || !surfaceRef.current) {
                        return
                      }
                      const point = pointerToRelative(event, surfaceRef.current)
                      if (!pointInPolygon(point, polygonVertices)) {
                        return
                      }
                      setInteraction({
                        kind: 'move',
                        pointerId: event.pointerId,
                        blockId,
                        start: point,
                        initialGeometry: block.geometry,
                        initialVertices: polygonVertices,
                      })
                    }}
                  >
                    <svg className="region-polygon-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                      <polygon className="region-polygon-shape" points={polygonPointsToLocalString(block)} />
                    </svg>
                    <span className="region-label">
                      {block.block_type}
                      <strong>#{block.order_index + 1}</strong>
                    </span>
                    {isSelected && !isLocked
                      ? polygonVertices.map((vertex, index) => (
                          <span
                            key={`${blockId}-vertex-${index}`}
                            className="region-handle region-handle-vertex"
                            style={{
                              left: `${((vertex.x - block.geometry.x) / block.geometry.width) * 100}%`,
                              top: `${((vertex.y - block.geometry.y) / block.geometry.height) * 100}%`,
                            }}
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setInteraction({
                                kind: 'vertex',
                                pointerId: event.pointerId,
                                blockId,
                                vertexIndex: index,
                                initialVertices: polygonVertices,
                              })
                            }}
                          />
                        ))
                      : null}
                  </div>
                )
              }

              return (
                <div
                  key={blockId}
                  className={`region region-${block.block_type} ${isSelected ? 'region-selected' : ''}`}
                  style={commonStyle}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    onSelectBlock(blockId)
                    if (spacePressed || event.button === 1) {
                      startPanning(event)
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
                      initialGeometry: block.geometry,
                      initialVertices: null,
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
            {draftRectGeometry ? (
              <div
                className="region region-draft"
                style={{
                  left: `${draftRectGeometry.x * 100}%`,
                  top: `${draftRectGeometry.y * 100}%`,
                  width: `${draftRectGeometry.width * 100}%`,
                  height: `${draftRectGeometry.height * 100}%`,
                }}
              />
            ) : null}
            {draftFreeformPoints && draftFreeformPoints.length >= 2 ? (
              <svg className="canvas-draft-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <polygon className="canvas-draft-polygon" points={polygonPointsToCanvasString(draftFreeformPoints)} />
              </svg>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
})
