import type { CanvasViewportState } from '../../components/DocumentCanvas'
import { draftBlockKey, type DraftBlock, type DraftPageLayout } from '../../lib/segmentation'

interface WorkspaceReviewPanelProps {
  pageDraft: DraftPageLayout
  selectedBlock: DraftBlock | null
  selectedPageLayoutVersion: number
  viewportState: CanvasViewportState
  onSelectBlock: (blockId: string) => void
}

export function WorkspaceReviewPanel({
  pageDraft,
  selectedBlock,
  selectedPageLayoutVersion,
  viewportState,
  onSelectBlock,
}: WorkspaceReviewPanelProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Page Review</p>
        </div>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span>Blocks</span>
          <strong>{pageDraft.blocks.length}</strong>
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
          const isSelected = selectedBlock ? draftBlockKey(selectedBlock) === blockKey : false
          return (
            <button
              key={blockKey}
              type="button"
              className={`block-list-item ${isSelected ? 'block-list-item-active' : ''}`}
              onClick={() => onSelectBlock(blockKey)}
            >
              <div>
                <strong>
                  #{block.order_index + 1} {block.block_type}
                </strong>
                <p>{block.approval}</p>
              </div>
              <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
