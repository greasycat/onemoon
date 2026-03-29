import type { DraftBlock } from '../lib/segmentation'

interface BlockInspectorProps {
  block: DraftBlock | null
  selectedCount: number
  isBusy: boolean
  conversionInstruction?: string
  onChangeConversionInstruction?: (instruction: string) => void
  onConvert?: () => void
}

export function BlockInspector({
  block,
  selectedCount,
  isBusy,
  conversionInstruction = '',
  onChangeConversionInstruction,
  onConvert,
}: BlockInspectorProps) {
  if (selectedCount > 1) {
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Conversion</p>
            <h2>Choose one block</h2>
          </div>
        </div>
        <p className="empty-state">Select a single block to enter instructions and generate document source for it.</p>
      </aside>
    )
  }

  if (!block) {
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Conversion</p>
            <h2>No block selected</h2>
          </div>
        </div>
        <p className="empty-state">Select a block to send it through conversion.</p>
      </aside>
    )
  }

  const hasOutput = Boolean(block.manual_output?.trim() || block.generated_output?.trim())

  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Conversion</p>
          <h2>Block #{block.order_index + 1}</h2>
        </div>
        <span className={`status-chip status-${hasOutput ? 'segmented' : 'pending'}`}>{hasOutput ? 'converted' : 'pending'}</span>
      </div>

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
        <h3>Block source</h3>
        <p className="selection-hint review-panel-hint">
          {hasOutput
            ? 'Converted LaTeX is shown in the block source panel on the right.'
            : 'Convert this block to populate the block source panel on the right.'}
        </p>
      </div>
    </aside>
  )
}
