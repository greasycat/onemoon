import { useState } from 'react'

import { isPolygonBlock } from '../lib/segmentation'
import type { DraftBlock } from '../lib/segmentation'
import type { BlockApproval, BlockGeometry, BlockType } from '../lib/types'

interface BlockInspectorProps {
  block: DraftBlock | null
  selectedCount: number
  pageLocked: boolean
  isBusy: boolean
  onApply: (payload: {
    block_type: BlockType
    approval: BlockApproval
    geometry: BlockGeometry
  }) => void
  onDelete: () => void
  onDeleteSelection: () => void
  onDuplicate: () => void
  onMergePrevious: () => void
  onMergeNext: () => void
  onSplitHorizontal: () => void
  onSplitVertical: () => void
}

const blockTypes: BlockType[] = ['text', 'math', 'figure', 'unknown']
const approvals: BlockApproval[] = ['pending', 'approved', 'rejected']

function initialFormState(block: DraftBlock | null) {
  return {
    blockType: block?.block_type ?? 'unknown',
    approval: block?.approval ?? 'pending',
    geometry: block?.geometry ?? { x: 0, y: 0, width: 0, height: 0 },
  }
}

export function BlockInspector({
  block,
  selectedCount,
  pageLocked,
  isBusy,
  onApply,
  onDelete,
  onDeleteSelection,
  onDuplicate,
  onMergePrevious,
  onMergeNext,
  onSplitHorizontal,
  onSplitVertical,
}: BlockInspectorProps) {
  const [blockType, setBlockType] = useState<BlockType>(initialFormState(block).blockType)
  const [approval, setApproval] = useState<BlockApproval>(initialFormState(block).approval)
  const polygonBlock = isPolygonBlock(block)

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
        <select disabled={pageLocked} value={blockType} onChange={(event) => setBlockType(event.target.value as BlockType)}>
          {blockTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>

      <div className="approval-row">
        {approvals.map((option) => (
          <button
            key={option}
            type="button"
            disabled={pageLocked}
            className={`pill-button ${approval === option ? 'pill-button-active' : ''}`}
            onClick={() => setApproval(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="inspector-section">
        <h3>Structure</h3>
        <div className="button-grid">
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy} onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy} onClick={onDelete}>
            Delete
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy || polygonBlock} onClick={onMergePrevious}>
            Merge Prev
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy || polygonBlock} onClick={onMergeNext}>
            Merge Next
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy || polygonBlock} onClick={onSplitHorizontal}>
            Split H
          </button>
          <button type="button" className="secondary-button" disabled={pageLocked || isBusy || polygonBlock} onClick={onSplitVertical}>
            Split V
          </button>
        </div>
      </div>

      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          disabled={pageLocked || isBusy}
          onClick={() =>
            onApply({
              block_type: blockType,
              approval,
              geometry,
            })
          }
        >
          Apply To Draft
        </button>
      </div>
    </aside>
  )
}
