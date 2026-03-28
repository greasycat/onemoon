import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type MouseEvent as ReactMouseEvent } from 'react'

import { draftBlockKey, type DraftBlock, type DraftPageLayout } from '../../lib/segmentation'
import type { BlockSelectionMode } from '../../lib/types'

interface WorkspaceReviewPanelProps {
  activeBlockId: string | null
  pageDraft: DraftPageLayout
  selectedBlockIds: string[]
  selectedBlock: DraftBlock | null
  selectionCount: number
  onSelectBlock: (blockId: string, mode?: BlockSelectionMode) => void
  onCycleBlockType: (blockId: string) => void
}

export function WorkspaceReviewPanel({
  activeBlockId,
  pageDraft,
  selectedBlockIds,
  selectedBlock,
  selectionCount,
  onSelectBlock,
  onCycleBlockType,
}: WorkspaceReviewPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  function selectionModeForEvent(event: Pick<ReactMouseEvent<HTMLButtonElement>, 'metaKey' | 'ctrlKey' | 'shiftKey'>): BlockSelectionMode {
    if (event.shiftKey) {
      return 'range'
    }
    if (event.metaKey || event.ctrlKey) {
      return 'toggle'
    }
    return 'replace'
  }

  const ToggleIcon = isCollapsed ? ChevronRight : ChevronDown

  return (
    <aside className={`workspace-review-panel ${isCollapsed ? 'workspace-review-panel-collapsed' : ''}`} aria-label="Block list">
      <div className="panel-heading">
        <div className="workspace-review-panel-heading">
          <div className="workspace-review-panel-title-row">
            <button
              type="button"
              className="workspace-review-toggle"
              aria-expanded={!isCollapsed}
              aria-label={isCollapsed ? 'Expand block list' : 'Collapse block list'}
              onClick={() => setIsCollapsed((current) => !current)}
            >
              <ToggleIcon aria-hidden="true" />
            </button>
            <p className="eyebrow">Block List</p>
          </div>
        </div>
      </div>
      <div className="workspace-review-panel-body" aria-hidden={isCollapsed}>
        <div>
          <p className="selection-hint">Shift-click for a range. Cmd/Ctrl-click to toggle blocks. Delete removes the selection.</p>
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
      </div>
    </aside>
  )
}
