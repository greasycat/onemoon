import { useEffect, useState } from 'react'

import type { DraftBlock } from '../lib/segmentation'
import type { BlockApproval, BlockGeometry, BlockType } from '../lib/types'

interface BlockInspectorProps {
  block: DraftBlock | null
  selectedCount: number
  pageLocked: boolean
  isBusy: boolean
  isConversionMode?: boolean
  conversionInstruction?: string
  onApply: (payload: {
    block_type: BlockType
    geometry: BlockGeometry
  }) => void
  onDelete: () => void
  onDeleteSelection: () => void
  onDuplicate: () => void
  onChangeConversionInstruction?: (instruction: string) => void
  onConvert?: () => void
  onSaveReview?: (payload: { approval: BlockApproval; manualOutput: string | null }) => void
}

const blockTypes: BlockType[] = ['text', 'math', 'figure']
const reviewStates: BlockApproval[] = ['pending', 'approved', 'rejected']

function renderOutputSection(title: string, value: string) {
  return (
    <div className="generated-output">
      <strong>{title}</strong>
      <pre>{value}</pre>
    </div>
  )
}

export function BlockInspector({
  block,
  selectedCount,
  pageLocked,
  isBusy,
  isConversionMode = false,
  conversionInstruction = '',
  onApply,
  onDelete,
  onDeleteSelection,
  onDuplicate,
  onChangeConversionInstruction,
  onConvert,
  onSaveReview,
}: BlockInspectorProps) {
  const [reviewApproval, setReviewApproval] = useState<BlockApproval>('pending')
  const [manualOutputDraft, setManualOutputDraft] = useState('')

  useEffect(() => {
    if (!block) {
      setReviewApproval('pending')
      setManualOutputDraft('')
      return
    }
    setReviewApproval(block.approval)
    setManualOutputDraft(block.manual_output ?? '')
  }, [block])

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
  const hasOutput = Boolean(block.manual_output?.trim() || block.generated_output?.trim())
  const reviewIsDirty = reviewApproval !== block.approval || manualOutputDraft !== (block.manual_output ?? '')

  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Selected Block</p>
          <h2>Block #{block.order_index + 1}</h2>
        </div>
        <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
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

      {isConversionMode ? (
        <>
          <div className="inspector-section">
            <h3>Conversion</h3>
            <label className="field">
              <span>Instruction</span>
              <textarea
                rows={4}
                value={conversionInstruction}
                disabled={isBusy}
                placeholder={
                  block.block_type === 'math'
                    ? 'Optional guidance, for example: keep implied multiplication explicit.'
                    : 'Optional guidance, for example: preserve paragraph breaks and punctuation.'
                }
                onChange={(event) => onChangeConversionInstruction?.(event.target.value)}
              />
            </label>
            <p className="selection-hint review-panel-hint">
              {block.id ? 'Instructions are sent only when you convert this block.' : 'Save the page before converting this block.'}
            </p>
            <div className="button-grid">
              <button type="button" className="primary-button" disabled={isBusy || !onConvert || !block.id} onClick={onConvert}>
                {isBusy ? 'Converting...' : 'Convert'}
              </button>
            </div>
          </div>

          <div className="inspector-section">
            <h3>Outputs</h3>
            {block.generated_output?.trim() ? renderOutputSection('Generated output', block.generated_output) : null}
            {!hasOutput ? (
              <p className="empty-state">Convert this block to populate extracted text or math for the document preview.</p>
            ) : null}
          </div>

          <div className="inspector-section">
            <h3>Review</h3>
            <label className="field">
              <span>Status</span>
              <select value={reviewApproval} disabled={isBusy || !onSaveReview} onChange={(event) => setReviewApproval(event.target.value as BlockApproval)}>
                {reviewStates.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Manual output</span>
              <textarea
                rows={8}
                value={manualOutputDraft}
                disabled={isBusy || !onSaveReview}
                placeholder={block.generated_output?.trim() ? 'Refine the generated output or leave empty to keep it.' : 'Enter a manual transcription for this block.'}
                onChange={(event) => setManualOutputDraft(event.target.value)}
              />
            </label>
            <p className="selection-hint review-panel-hint">
              {block.manual_output?.trim()
                ? 'A saved manual output currently overrides the generated result in the document preview.'
                : 'Manual output is optional. Leave it empty to use the generated result directly.'}
            </p>
            <div className="button-grid">
              <button
                type="button"
                className="secondary-button"
                disabled={isBusy || !onSaveReview || !reviewIsDirty}
                onClick={() =>
                  onSaveReview?.({
                    approval: reviewApproval,
                    manualOutput: manualOutputDraft.trim() ? manualOutputDraft.trim() : null,
                  })}
              >
                {isBusy ? 'Saving...' : 'Save Review'}
              </button>
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
        </>
      ) : (
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
      )}
    </aside>
  )
}
