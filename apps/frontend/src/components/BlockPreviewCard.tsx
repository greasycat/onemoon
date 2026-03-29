import { withApiRoot } from '../lib/api'
import type { DraftBlock } from '../lib/segmentation'

interface BlockPreviewCardProps {
  block: DraftBlock | null
}

export function BlockPreviewCard({ block }: BlockPreviewCardProps) {
  if (!block) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Preview</p>
            <h2>No block selected</h2>
          </div>
        </div>
        <p className="empty-state">Select a block to inspect its crop, metadata, and review warnings.</p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>Block #{block.order_index + 1}</h2>
        </div>
        <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
      </div>

      <div className="crop-preview">
        {block.crop_url ? (
          <img src={withApiRoot(block.crop_url) ?? undefined} alt={`Preview for block ${block.order_index + 1}`} />
        ) : (
          <div className="preview-empty-state">
            <strong>No preview image</strong>
            <span>Preview refreshes after save for newly edited manual blocks.</span>
          </div>
        )}
      </div>

      <div className="preview-meta-grid">
        <div className="stat-card">
          <span>Source</span>
          <strong>{block.source}</strong>
        </div>
        <div className="stat-card">
          <span>Confidence</span>
          <strong>{Math.round(block.confidence * 100)}%</strong>
        </div>
        <div className="stat-card">
          <span>Type</span>
          <strong>{block.block_type}</strong>
        </div>
        <div className="stat-card">
          <span>Approval</span>
          <strong>{block.approval}</strong>
        </div>
      </div>

      {block.warnings.length > 0 ? (
        <div className="inspector-section">
          <h3>Warnings</h3>
          <ul className="warning-list">
            {block.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
