import type { DraftBlock } from '../lib/segmentation'
import type { BlockGeometry, BlockType } from '../lib/types'

interface BlockInspectorProps {
  block: DraftBlock | null
  selectedCount: number
  pageLocked: boolean
  isBusy: boolean
  onApply: (payload: {
    block_type: BlockType
    geometry: BlockGeometry
  }) => void
  onDelete: () => void
  onDeleteSelection: () => void
  onDuplicate: () => void
}

const blockTypes: BlockType[] = ['text', 'math', 'figure']

export function BlockInspector({
  block,
  selectedCount,
  pageLocked,
  isBusy,
  onApply,
  onDelete,
  onDeleteSelection,
  onDuplicate,
}: BlockInspectorProps) {
  if (selectedCount > 1) {
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Selection</p>
            <h2>{selectedCount} blocks selected</h2>
          </div>
          <span className="status-chip status-review">bulk</span>
        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span>Selected</span>
            <strong>{selectedCount}</strong>
          </div>
          <div className="stat-card">
            <span>Available action</span>
            <strong>Delete</strong>
          </div>
        </div>

        <p className="muted-text">Single-block editing is disabled while multiple blocks are selected.</p>

        <div className="button-row">
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy} onClick={onDeleteSelection}>
            Delete Selected
          </button>
        </div>
      </aside>
    )
  }

  if (!block) {
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Selected Block</p>
            <h2>No block selected</h2>
          </div>
        </div>
        <p className="empty-state">Select a block on the page or create one in draw mode to begin manual segmentation.</p>
      </aside>
    )
  }

  const geometry = block.geometry

  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected Block</p>
          <h2>Block #{block.order_index + 1}</h2>
        </div>
        <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <span>Source</span>
          <strong>{block.source}</strong>
        </div>
        <div className="stat-card">
          <span>Confidence</span>
          <strong>{Math.round(block.confidence * 100)}%</strong>
        </div>
        <div className="stat-card">
          <span>Shape</span>
          <strong>{block.shape_type}</strong>
        </div>
      </div>

      <label className="field">
        <span>Block type</span>
        <select
          disabled={pageLocked || isBusy}
          value={block.block_type}
          onChange={(event) => {
            const nextBlockType = event.target.value as BlockType
            if (nextBlockType === block.block_type) {
              return
            }
            onApply({
              block_type: nextBlockType,
              geometry,
            })
          }}
        >
          {blockTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <p className="selection-hint review-panel-hint">Tip: double-click a block on the page or in the review list to cycle its type faster.</p>
      </label>

      <div className="inspector-section">
        <h3>Structure</h3>
        <div className="button-grid">
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </aside>
  )
}
