import { useMemo } from 'react'

import { withApiRoot } from '../../lib/api'
import type { CompileArtifactResponse, DocumentDetailResponse } from '../../lib/types'

interface WorkspaceDocumentPreviewProps {
  document: DocumentDetailResponse
}

function compareArtifacts(left: CompileArtifactResponse, right: CompileArtifactResponse) {
  if (left.version !== right.version) {
    return right.version - left.version
  }
  return right.created_at.localeCompare(left.created_at)
}

function buildFallbackLatex(document: DocumentDetailResponse) {
  const safeTitle = document.title.replace(/[{}]/g, '')
  return [
    '\\documentclass[11pt]{article}',
    '\\usepackage[margin=1in]{geometry}',
    '\\usepackage{amsmath}',
    '\\usepackage{amssymb}',
    '\\usepackage{graphicx}',
    '\\usepackage{microtype}',
    `\\title{${safeTitle || 'Untitled document'}}`,
    '\\date{}',
    '\\begin{document}',
    '\\maketitle',
    '',
    '% Conversion preview is waiting for assembled LaTeX.',
    `% Document status: ${document.status}`,
    `% Pages loaded: ${document.pages.length}`,
    document.latest_compile_status ? `% Latest compile: ${document.latest_compile_status}` : '% Latest compile: not started',
    '',
    '% Review the current page layout, then assemble or compile the document to replace this shell.',
    '',
    '\\end{document}',
  ].join('\n')
}

function compileStatusSummary(document: DocumentDetailResponse, hasPdfPreview: boolean) {
  if (document.latest_compile_status) {
    return {
      label: document.latest_compile_status,
      tone: document.latest_compile_status,
    }
  }

  return {
    label: hasPdfPreview ? 'completed' : 'source only',
    tone: hasPdfPreview ? 'completed' : 'pending',
  } as const
}

export function WorkspaceDocumentPreview({ document }: WorkspaceDocumentPreviewProps) {
  const latestArtifact = useMemo(
    () => [...document.compile_artifacts].sort(compareArtifacts)[0] ?? null,
    [document.compile_artifacts],
  )
  const previewUrl = latestArtifact?.pdf_url ? withApiRoot(latestArtifact.pdf_url) : null
  const latexSource = document.assembled_latex?.trim() || buildFallbackLatex(document)
  const isFallbackPreview = !document.assembled_latex?.trim()
  const status = compileStatusSummary(document, Boolean(previewUrl))
  const latexLineCount = latexSource.split('\n').length

  return (
    <aside className="workspace-document-preview panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Conversion</p>
          <h2>LaTeX document</h2>
        </div>
        <span className={`status-chip status-${status.tone}`}>{status.label}</span>
      </div>

      <p className="workspace-document-preview-copy">
        Full-document source for <strong>{document.title || document.filename}</strong>. The rendered preview uses the latest compiled PDF artifact when one is available.
      </p>

      <div className="stats-grid workspace-document-preview-stats">
        <div className="stat-card">
          <span>Pages</span>
          <strong>{document.pages.length}</strong>
        </div>
        <div className="stat-card">
          <span>Artifacts</span>
          <strong>{document.compile_artifacts.length}</strong>
        </div>
        <div className="stat-card">
          <span>Latest build</span>
          <strong>{latestArtifact ? `v${latestArtifact.version}` : 'None'}</strong>
        </div>
        <div className="stat-card">
          <span>LaTeX lines</span>
          <strong>{latexLineCount}</strong>
        </div>
      </div>

      <section className="workspace-document-preview-section">
        <div className="workspace-document-preview-section-header">
          <h3>Rendered preview</h3>
          <span className={`status-chip ${previewUrl ? 'status-completed' : 'status-pending'}`}>
            {previewUrl ? 'pdf ready' : 'waiting'}
          </span>
        </div>
        {previewUrl ? (
          <div className="artifact-preview workspace-document-preview-frame">
            <iframe src={previewUrl} title={`${document.title || document.filename} PDF preview`} />
          </div>
        ) : (
          <div className="workspace-document-preview-empty preview-empty-state">
            <strong>No compiled preview yet</strong>
            <span>Compile the document to render a PDF preview. The assembled LaTeX source remains visible below.</span>
          </div>
        )}
      </section>

      <section className="workspace-document-preview-section workspace-document-source">
        <div className="workspace-document-preview-section-header workspace-document-source-header">
          <h3>Assembled LaTeX</h3>
          <span className={`status-chip ${isFallbackPreview ? 'status-pending' : 'status-review'}`}>
            {isFallbackPreview ? 'placeholder' : 'assembled'}
          </span>
        </div>
        <div className="generated-output workspace-document-preview-source">
          <pre>{latexSource}</pre>
        </div>
      </section>
    </aside>
  )
}
