import { useState } from 'react'

import { withApiRoot } from '../lib/api'
import type { BlockApproval, BlockPatchPayload, BlockResponse, BlockType } from '../lib/types'

interface BlockInspectorProps {
  block: BlockResponse | null
  onSave: (payload: BlockPatchPayload) => void
  onRegenerate: (instruction: string) => void
  isBusy: boolean
}

const blockTypes: BlockType[] = ['text', 'math', 'figure', 'unknown']
const approvals: BlockApproval[] = ['pending', 'approved', 'rejected']

function initialFormState(block: BlockResponse | null) {
  return {
    blockType: block?.block_type ?? 'unknown',
    approval: block?.approval ?? 'pending',
    manualOutput: block?.manual_output ?? block?.generated_output ?? '',
    instruction: block?.user_instruction ?? '',
    geometry: block?.geometry ?? { x: 0, y: 0, width: 0, height: 0 },
  }
}

export function BlockInspector({ block, onSave, onRegenerate, isBusy }: BlockInspectorProps) {
  const [blockType, setBlockType] = useState<BlockType>(initialFormState(block).blockType)
  const [approval, setApproval] = useState<BlockApproval>(initialFormState(block).approval)
  const [manualOutput, setManualOutput] = useState(initialFormState(block).manualOutput)
  const [instruction, setInstruction] = useState(initialFormState(block).instruction)
  const [geometry, setGeometry] = useState(initialFormState(block).geometry)

  if (!block) {
    return (
      <aside className="inspector-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Inspector</p>
            <h2>No block selected</h2>
          </div>
        </div>
        <p className="empty-state">Pick a region on the page to review its conversion, adjust its type, or provide a manual correction.</p>
      </aside>
    )
  }

  return (
    <aside className="inspector-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Block #{block.order_index + 1}</p>
          <h2>{block.block_type} region</h2>
        </div>
        <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
      </div>

      <div className="crop-preview">
        {block.crop_url ? <img src={withApiRoot(block.crop_url) ?? undefined} alt="Block crop" /> : <div className="empty-state">No crop available.</div>}
      </div>

      <label className="field">
        <span>Block type</span>
        <select value={blockType} onChange={(event) => setBlockType(event.target.value as BlockType)}>
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
            className={`pill-button ${approval === option ? 'pill-button-active' : ''}`}
            onClick={() => setApproval(option)}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="geometry-grid">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <label className="field" key={key}>
            <span>{key}</span>
            <input
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={geometry[key]}
              onChange={(event) =>
                setGeometry((current) => ({
                  ...current,
                  [key]: Number(event.target.value),
                }))
              }
            />
          </label>
        ))}
      </div>

      <label className="field">
        <span>Manual output</span>
        <textarea
          rows={7}
          value={manualOutput}
          onChange={(event) => setManualOutput(event.target.value)}
        />
      </label>

      <label className="field">
        <span>Regeneration hint</span>
        <textarea
          rows={3}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Explain how this block should be interpreted."
        />
      </label>

      <details className="generated-output" open>
        <summary>Generated output</summary>
        <pre>{block.generated_output ?? '% No generated output yet.'}</pre>
        {block.warnings.length > 0 ? (
          <ul className="warning-list">
            {block.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        ) : null}
      </details>

      <div className="button-row">
        <button
          type="button"
          className="primary-button"
          disabled={isBusy}
          onClick={() =>
            onSave({
              block_type: blockType,
              approval,
              geometry,
              manual_output: manualOutput,
              user_instruction: instruction,
            })
          }
        >
          Save block
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isBusy}
          onClick={() => onRegenerate(instruction)}
        >
          Regenerate
        </button>
      </div>
    </aside>
  )
}
