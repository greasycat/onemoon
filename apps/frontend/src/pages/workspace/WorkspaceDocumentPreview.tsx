import { useMemo } from 'react'

import { withApiRoot } from '../../lib/api'
import type { DraftBlock } from '../../lib/segmentation'
import type { CompileArtifactResponse, DocumentDetailResponse } from '../../lib/types'

interface WorkspaceDocumentPreviewProps {
  document: DocumentDetailResponse
  selectedBlock?: DraftBlock | null
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
    '% Adjust the current page layout, then assemble or compile the document to replace this shell.',
    '',
    '\\end{document}',
  ].join('\n')
}

export function WorkspaceDocumentPreview({ document, selectedBlock = null }: WorkspaceDocumentPreviewProps) {
  const latestArtifact = useMemo(
    () => [...document.compile_artifacts].sort(compareArtifacts)[0] ?? null,
    [document.compile_artifacts],
  )
  const previewUrl = latestArtifact?.pdf_url ? withApiRoot(latestArtifact.pdf_url) : null
  const latexSource = document.assembled_latex?.trim() || buildFallbackLatex(document)
  const selectedBlockCropUrl = selectedBlock?.crop_url ? withApiRoot(selectedBlock.crop_url) : null
  const selectedBlockHasOutput = Boolean(selectedBlock?.manual_output?.trim() || selectedBlock?.generated_output?.trim())
  const placeholderBlock = !previewUrl && selectedBlock && selectedBlockCropUrl && !selectedBlockHasOutput ? selectedBlock : null

  return (
    <aside className="workspace-document-preview">
      <div className="workspace-document-preview-section">
        {previewUrl ? (
          <div className="artifact-preview workspace-document-preview-frame">
            <iframe src={previewUrl} title={`${document.title || document.filename} PDF preview`} />
          </div>
        ) : (
          <div className="workspace-document-preview-empty preview-empty-state">
            {placeholderBlock ? (
              <div className="crop-preview workspace-document-preview-placeholder">
                <img src={selectedBlockCropUrl ?? undefined} alt={`Placeholder crop for block ${placeholderBlock.order_index + 1}`} />
              </div>
            ) : null}
            <strong>No compiled preview yet</strong>
            <span>
              {placeholderBlock
                ? 'Using the selected block crop as a placeholder until conversion or compilation runs.'
                : 'Compile the document to render a PDF preview. The assembled LaTeX source remains visible below.'}
            </span>
          </div>
        )}
      </div>

      <section className="workspace-document-preview-section workspace-document-source">
        <p className="eyebrow">Document source</p>
        <div className="generated-output workspace-document-preview-source">
          <pre>{latexSource}</pre>
        </div>
      </section>
    </aside>
  )
}
