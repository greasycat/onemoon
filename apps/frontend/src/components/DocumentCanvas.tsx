import type { PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { BlockGeometry, PageResponse } from '../lib/types'
import { withApiRoot } from '../lib/api'

interface PointerState {
  pointerId: number
  start: { x: number; y: number }
  current: { x: number; y: number }
}

interface ResizeState {
  pointerId: number
  blockId: string
  initial: BlockGeometry
}

interface DocumentCanvasProps {
  page: PageResponse
  selectedBlockId: string | null
  onSelectBlock: (blockId: string) => void
  onCreateBlock: (geometry: BlockGeometry) => void
  onResizeBlock: (blockId: string, geometry: BlockGeometry) => void
}

const MIN_SIZE = 0.02

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function normalizeGeometry(start: { x: number; y: number }, end: { x: number; y: number }): BlockGeometry {
  const x = clamp(Math.min(start.x, end.x))
  const y = clamp(Math.min(start.y, end.y))
  const width = clamp(Math.abs(end.x - start.x))
  const height = clamp(Math.abs(end.y - start.y))
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

export function DocumentCanvas({
  page,
  selectedBlockId,
  onSelectBlock,
  onCreateBlock,
  onResizeBlock,
}: DocumentCanvasProps) {
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [draft, setDraft] = useState<PointerState | null>(null)
  const [resize, setResize] = useState<ResizeState | null>(null)

  useEffect(() => {
    if (!draft && !resize) {
      return undefined
    }

    function handlePointerMove(event: PointerEvent) {
      if (!frameRef.current) {
        return
      }
      if (draft && event.pointerId === draft.pointerId) {
        setDraft((current) =>
          current
            ? {
                ...current,
                current: pointerToRelative(event, frameRef.current!),
              }
            : null,
        )
      }

      if (resize && event.pointerId === resize.pointerId) {
        const point = pointerToRelative(event, frameRef.current)
        const width = Math.max(MIN_SIZE, clamp(point.x - resize.initial.x))
        const height = Math.max(MIN_SIZE, clamp(point.y - resize.initial.y))
        onResizeBlock(resize.blockId, {
          x: resize.initial.x,
          y: resize.initial.y,
          width,
          height,
        })
      }
    }

    function handlePointerUp(event: PointerEvent) {
      if (draft && frameRef.current && event.pointerId === draft.pointerId) {
        const geometry = normalizeGeometry(draft.start, draft.current)
        if (geometry.width >= MIN_SIZE && geometry.height >= MIN_SIZE) {
          onCreateBlock(geometry)
        }
        setDraft(null)
      }
      if (resize && event.pointerId === resize.pointerId) {
        setResize(null)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [draft, onCreateBlock, onResizeBlock, resize])

  const draftGeometry =
    draft && normalizeGeometry(draft.start, draft.current)

  return (
    <section className="canvas-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Page {page.page_index + 1}</p>
          <h2>Region Review</h2>
        </div>
        <p className="canvas-hint">Drag on empty space to add a new block. Drag the handle to resize the selected block.</p>
      </div>
      <div
        className="canvas-frame"
        ref={frameRef}
        style={{ aspectRatio: `${page.width} / ${page.height}` }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) {
            return
          }
          const point = pointerToRelative(event, event.currentTarget)
          setDraft({ pointerId: event.pointerId, start: point, current: point })
        }}
      >
        <img className="canvas-image" src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
        {page.blocks.map((block) => {
          const isSelected = block.id === selectedBlockId
          return (
            <button
              key={block.id}
              type="button"
              className={`region region-${block.block_type} ${isSelected ? 'region-selected' : ''}`}
              style={{
                left: `${block.geometry.x * 100}%`,
                top: `${block.geometry.y * 100}%`,
                width: `${block.geometry.width * 100}%`,
                height: `${block.geometry.height * 100}%`,
              }}
              onClick={() => onSelectBlock(block.id)}
            >
              <span className="region-label">
                {block.block_type}
                <strong>#{block.order_index + 1}</strong>
              </span>
              {isSelected ? (
                <span
                  className="region-resize-handle"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setResize({
                      pointerId: event.pointerId,
                      blockId: block.id,
                      initial: block.geometry,
                    })
                  }}
                />
              ) : null}
            </button>
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
