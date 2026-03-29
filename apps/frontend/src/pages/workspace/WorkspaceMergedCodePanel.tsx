import { Copy, Download } from 'lucide-react'
import { useState } from 'react'

interface WorkspaceMergedCodePanelProps {
  mergedSource: string
  isDownloadingPackage: boolean
  isMerging: boolean
  onDownload: () => void
  onCopy: () => void
  onMerge: (suggestion: string) => void
}

export function WorkspaceMergedCodePanel({
  mergedSource,
  isDownloadingPackage,
  isMerging,
  onDownload,
  onCopy,
  onMerge,
}: WorkspaceMergedCodePanelProps) {
  const [mergeSuggestion, setMergeSuggestion] = useState('')

  return (
    <aside className="workspace-merged-code-panel">
      <section className="workspace-document-preview-section">
        <div className="workspace-document-source workspace-merged-code-controls">
          <div className="panel-heading workspace-merged-code-heading">
            <div>
              <p className="eyebrow">Merge review</p>
              <h2>Build merged code</h2>
            </div>
          </div>
          <label className="field">
            <span>Optional LLM suggestion</span>
            <input
              type="text"
              value={mergeSuggestion}
              disabled={isMerging}
              placeholder="Optional guidance, for example: preserve section order and tighten repeated prose."
              onChange={(event) => setMergeSuggestion(event.target.value)}
            />
          </label>
          <p className="selection-hint review-panel-hint">
            Merge uses the current assembled source and applies the suggestion only when your configured provider supports it.
          </p>
          <div className="button-grid">
            <button
              type="button"
              className="primary-button workspace-merged-code-merge-button"
              disabled={isMerging}
              onClick={() => onMerge(mergeSuggestion)}
            >
              {isMerging ? 'Merging...' : 'Merge'}
            </button>
          </div>
        </div>
      </section>

      <section className="workspace-document-preview-section">
        <div className="workspace-document-source workspace-merged-code-card">
          <div className="panel-heading workspace-merged-code-heading workspace-merged-code-heading-actions">
            <div>
              <p className="eyebrow">Merged code</p>
              <h2>Latest output</h2>
            </div>
            <div className="workspace-merged-code-actions">
              <button
                type="button"
                className="secondary-button workspace-merged-code-copy-button"
                aria-label="Download merged package"
                title="Download merged package"
                disabled={isDownloadingPackage}
                onClick={onDownload}
              >
                <Download aria-hidden="true" />
              </button>
              <button
                type="button"
                className="secondary-button workspace-merged-code-copy-button"
                aria-label="Copy merged code"
                title="Copy merged code"
                onClick={onCopy}
              >
                <Copy aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="generated-output workspace-merged-code-source">
            <pre>{mergedSource}</pre>
          </div>
        </div>
      </section>
    </aside>
  )
}
