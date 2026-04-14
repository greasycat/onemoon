import { Copy, Download } from 'lucide-react'
import { useState } from 'react'

import type { OutputFormat } from '../../lib/types'
import type { CompilePdfState } from './useWorkspaceController'

interface WorkspaceMergedCodePanelProps {
  mergedSource: string
  isDownloadingPackage: boolean
  isMerging: boolean
  outputFormat: OutputFormat
  onDownload: () => void
  onCopy: () => void
  onMerge: (suggestion: string) => void
  onOutputFormatChange: (format: OutputFormat) => void
  compilePdfState: CompilePdfState
  onCompilePdf: () => void
}

export function WorkspaceMergedCodePanel({
  mergedSource,
  isDownloadingPackage,
  isMerging,
  outputFormat,
  onDownload,
  onCopy,
  onMerge,
  onOutputFormatChange,
  compilePdfState,
  onCompilePdf,
}: WorkspaceMergedCodePanelProps) {
  const [mergeSuggestion, setMergeSuggestion] = useState('')
  const [showCompileLog, setShowCompileLog] = useState(false)

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
          <div className="field">
            <span className="field-label">Output format</span>
            <div className="button-grid">
              <button
                type="button"
                className={outputFormat === 'latex' ? 'primary-button' : 'secondary-button'}
                onClick={() => onOutputFormatChange('latex')}
              >
                LaTeX
              </button>
              <button
                type="button"
                className={outputFormat === 'typst' ? 'primary-button' : 'secondary-button'}
                onClick={() => onOutputFormatChange('typst')}
              >
                Typst
              </button>
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
            <button
              type="button"
              className="secondary-button workspace-merged-code-compile-button"
              disabled={compilePdfState.status === 'compiling'}
              onClick={onCompilePdf}
            >
              {compilePdfState.status === 'compiling' ? 'Compiling...' : 'Compile & Download PDF'}
            </button>
          </div>
          {compilePdfState.status === 'skipped' && (
            <p className="selection-hint review-panel-hint">
              Compilation skipped: tectonic is not installed on the server.
            </p>
          )}
          {compilePdfState.status === 'failed' && (
            <div className="workspace-compile-error">
              <button
                type="button"
                className="workspace-compile-log-toggle"
                onClick={() => setShowCompileLog((v) => !v)}
              >
                {showCompileLog ? 'Hide compile log' : 'Show compile log'}
              </button>
              {showCompileLog && (
                <pre className="workspace-compile-log">{compilePdfState.log}</pre>
              )}
            </div>
          )}
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
