import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import { withApiRoot } from '../lib/api'
import { clamp, clampGeometry, draftBlockKey, type DraftBlock } from '../lib/segmentation'
import type { BlockGeometry, PageResponse } from '../lib/types'

type ActiveTool = 'select' | 'create'
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

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
  onSelectBlock: (blockId: string) => void
  onCreateBlock: (geometry: BlockGeometry) => void
  onUpdateBlockGeometry: (blockId: string, geometry: BlockGeometry) => void
}

const MIN_SIZE = 0.02
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

export function DocumentCanvas({
  page,
  blocks,
  selectedBlockId,
  activeTool,
  isLocked,
  onSelectBlock,
  onCreateBlock,
  onUpdateBlockGeometry,
}: DocumentCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [interaction, setInteraction] = useState<InteractionState | null>(null)

  useEffect(() => {
    if (!interaction || isLocked) {
      return undefined
    }
    const currentInteraction = interaction

    function handlePointerMove(event: PointerEvent) {
      if (!frameRef.current) {
        return
      }
      const point = pointerToRelative(event, frameRef.current)

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

  const draftGeometry =
    interaction?.kind === 'create' ? normalizeGeometry(interaction.start, interaction.current) : null

  return (
    <section className="canvas-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Page {page.page_index + 1}</p>
          <h2>Manual Segmentation</h2>
        </div>
        <p className="canvas-hint">
          {isLocked
            ? 'This page is marked segmented. Reopen it to edit the layout.'
            : activeTool === 'create'
              ? 'Drag on the page to create a new block.'
              : 'Drag blocks to move them. Use the handles to resize.'}
        </p>
      </div>
      <div
        className={`canvas-frame ${activeTool === 'create' && !isLocked ? 'canvas-frame-draw' : ''}`}
        ref={frameRef}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={(event) => {
          if (isLocked || activeTool !== 'create' || event.target !== event.currentTarget) {
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
                if (isLocked || activeTool !== 'select') {
                  return
                }
                setInteraction({
                  kind: 'move',
                  pointerId: event.pointerId,
                  blockId,
                  start: pointerToRelative(event, event.currentTarget),
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
                        event.preventDefault()
                        event.stopPropagation()
                        setInteraction({
                          kind: 'resize',
                          pointerId: event.pointerId,
                          blockId,
                          handle,
                          start: pointerToRelative(event, event.currentTarget),
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
    </section>
  )
}
