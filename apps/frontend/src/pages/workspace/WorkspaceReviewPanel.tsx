import type { MouseEvent as ReactMouseEvent } from 'react'

import type { CanvasViewportState } from '../../components/DocumentCanvas'
import { draftBlockKey, type DraftBlock, type DraftPageLayout } from '../../lib/segmentation'
import type { BlockSelectionMode } from '../../lib/types'

interface WorkspaceReviewPanelProps {
  activeBlockId: string | null
  pageDraft: DraftPageLayout
  selectedBlockIds: string[]
  selectedBlock: DraftBlock | null
  selectionCount: number
  selectedPageLayoutVersion: number
  viewportState: CanvasViewportState
  onSelectBlock: (blockId: string, mode?: BlockSelectionMode) => void
  onCycleBlockType: (blockId: string) => void
}

export function WorkspaceReviewPanel({
  activeBlockId,
  pageDraft,
  selectedBlockIds,
  selectedBlock,
  selectionCount,
  selectedPageLayoutVersion,
  viewportState,
  onSelectBlock,
  onCycleBlockType,
}: WorkspaceReviewPanelProps) {
  function selectionModeForEvent(event: Pick<ReactMouseEvent<HTMLButtonElement>, 'metaKey' | 'ctrlKey' | 'shiftKey'>): BlockSelectionMode {
    if (event.shiftKey) {
      return 'range'
    }
    if (event.metaKey || event.ctrlKey) {
      return 'toggle'
    }
    return 'replace'
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Page Review</p>
          <p className="selection-hint">Shift-click for a range. Cmd/Ctrl-click to toggle blocks. Delete removes the selection.</p>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span>Blocks</span>
          <strong>{pageDraft.blocks.length}</strong>
        </div>
        <div className="stat-card">
          <span>Selected</span>
          <strong>{selectionCount}</strong>
        </div>
        <div className="stat-card">
          <span>Layout Version</span>
          <strong>{selectedPageLayoutVersion}</strong>
        </div>
        <div className="stat-card">
          <span>Zoom</span>
          <strong>{Math.round(viewportState.zoom * 100)}%</strong>
        </div>
        <div className="stat-card">
          <span>View</span>
          <strong>{viewportState.mode}</strong>
        </div>
      </div>
      <div className="block-list">
        {pageDraft.blocks.map((block) => {
          const blockKey = draftBlockKey(block)
          const isSelected = selectedBlockIds.includes(blockKey)
          const isPrimarySelected = blockKey === activeBlockId
          return (
            <button
              key={blockKey}
              type="button"
              className={`block-list-item ${isSelected ? 'block-list-item-active' : ''} ${isPrimarySelected ? 'block-list-item-primary' : ''}`}
              aria-pressed={isSelected}
              onClick={(event) => onSelectBlock(blockKey, selectionModeForEvent(event))}
              onDoubleClick={() => onCycleBlockType(blockKey)}
            >
              <div>
                <strong>
                  #{block.order_index + 1} {block.block_type}
                </strong>
                <p>{block.approval}</p>
              </div>
              <div className="block-list-status">
                {isPrimarySelected && selectedBlock ? <span className="selection-chip">focus</span> : null}
                <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
