import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState, type MouseEvent as ReactMouseEvent } from 'react'

import { draftBlockKey, type DraftPageLayout } from '../../lib/segmentation'
import type { BlockSelectionMode, OutputFormat } from '../../lib/types'

interface WorkspaceReviewPanelProps {
  activeBlockId: string | null
  canConvertAll?: boolean
  isConvertingAll?: boolean
  isConversionMode?: boolean
  outputFormat?: OutputFormat
  isUpdatingFormat?: boolean
  pageDraft: DraftPageLayout
  selectedBlockIds: string[]
  onConvertAll?: () => void
  onFormatChange?: (format: OutputFormat) => void
  onSelectBlock: (blockId: string, mode?: BlockSelectionMode) => void
  onCycleBlockType: (blockId: string) => void
}

export function WorkspaceReviewPanel({
  activeBlockId,
  canConvertAll = false,
  isConvertingAll = false,
  isConversionMode = false,
  outputFormat = 'latex',
  isUpdatingFormat = false,
  pageDraft,
  selectedBlockIds,
  onConvertAll,
  onFormatChange,
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
  const selectionHint = 'Shift-click for a range. Cmd/Ctrl-click to toggle blocks. Delete removes the selection.'

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
      <div
        className={`workspace-review-panel-body ${isConversionMode ? 'workspace-review-panel-body-conversion' : ''}`}
        aria-hidden={isCollapsed}
      >
        {!isConversionMode ? (
          <div>
            <p className="selection-hint">{selectionHint}</p>
          </div>
        ) : null}
        {isConversionMode ? (
          <div className="workspace-review-panel-actions">
            {onFormatChange ? (
              <div className="button-grid">
                <button
                  type="button"
                  className={outputFormat === 'latex' ? 'primary-button' : 'secondary-button'}
                  disabled={isUpdatingFormat || outputFormat === 'latex'}
                  onClick={() => onFormatChange('latex')}
                >
                  LaTeX
                </button>
                <button
                  type="button"
                  className={outputFormat === 'typst' ? 'primary-button' : 'secondary-button'}
                  disabled={isUpdatingFormat || outputFormat === 'typst'}
                  onClick={() => onFormatChange('typst')}
                >
                  Typst
                </button>
              </div>
            ) : null}
            <button type="button" className="secondary-button" disabled={!canConvertAll || isConvertingAll} onClick={onConvertAll}>
              {isConvertingAll ? 'Converting all...' : 'Convert all'}
            </button>
          </div>
        ) : null}
        <div className="block-list">
          {pageDraft.blocks.map((block) => {
            const blockKey = draftBlockKey(block)
            const isSelected = selectedBlockIds.includes(blockKey)
            const isPrimarySelected = blockKey === activeBlockId
            const hasOutput = Boolean(block.manual_output?.trim() || block.generated_output?.trim())
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
                  <p>{hasOutput ? 'converted source ready' : 'awaiting conversion'}</p>
                </div>
                <div className="block-list-status">
                  {isPrimarySelected ? <span className="selection-chip">focus</span> : null}
                  <span className={`status-chip status-${hasOutput ? 'segmented' : 'pending'}`}>{hasOutput ? 'converted' : 'pending'}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
