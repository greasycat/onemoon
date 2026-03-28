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

function normalizeSnippet(source: string) {
  return source.trim().replace(/\r\n/g, '\n')
}

function ensureDisplayMath(source: string) {
  if (source.startsWith('\\[') && source.endsWith('\\]')) {
    return source
  }
  if (source.startsWith('$$') && source.endsWith('$$')) {
    return source
  }
  if (/^\\begin\{(?:equation\*?|align\*?|gather\*?)\}[\s\S]*\\end\{(?:equation\*?|align\*?|gather\*?)\}$/.test(source)) {
    return source
  }
  if (source.startsWith('\\(') && source.endsWith('\\)')) {
    source = source.slice(2, -2).trim()
  } else if (source.startsWith('$') && source.endsWith('$')) {
    source = source.slice(1, -1).trim()
  }
  return `\\[\n${source}\n\\]`
}

function ensureTextBlock(source: string) {
  if (/^\\begin\{textblock\}[\s\S]*\\end\{textblock\}$/.test(source)) {
    return source
  }
  return ['\\begin{textblock}', source, '\\end{textblock}'].join('\n')
}

function buildBlockSource(selectedBlock: DraftBlock | null) {
  if (!selectedBlock) {
    return '% Select a block to inspect its LaTeX snippet.'
  }

  const convertedSource = selectedBlock.manual_output?.trim() || selectedBlock.generated_output?.trim()
  if (convertedSource) {
    const normalizedSource = normalizeSnippet(convertedSource)
    if (selectedBlock.block_type === 'math') {
      return ensureDisplayMath(normalizedSource)
    }
    if (selectedBlock.block_type === 'figure') {
      return ['% Figure block', '\\begin{figure}[h]', '\\centering', normalizedSource, '\\end{figure}'].join('\n')
    }
    if (selectedBlock.block_type === 'text') {
      return ensureTextBlock(normalizedSource)
    }
    return normalizedSource
  }

  if (selectedBlock.crop_url) {
    return [
      `% Pending conversion placeholder for block ${selectedBlock.id ?? selectedBlock.client_id}`,
      '\\begin{center}',
      `\\fbox{\\includegraphics[width=0.9\\linewidth]{${selectedBlock.crop_url}}}`,
      '\\end{center}',
    ].join('\n')
  }

  return '% Convert this block to generate its LaTeX snippet.'
}

export function WorkspaceDocumentPreview({ document, selectedBlock = null }: WorkspaceDocumentPreviewProps) {
  const latestArtifact = useMemo(
    () => [...document.compile_artifacts].sort(compareArtifacts)[0] ?? null,
    [document.compile_artifacts],
  )
  const previewUrl = latestArtifact?.pdf_url ? withApiRoot(latestArtifact.pdf_url) : null
  const blockSource = useMemo(() => buildBlockSource(selectedBlock), [selectedBlock])
  const selectedBlockCropUrl = selectedBlock?.crop_url ? withApiRoot(selectedBlock.crop_url) : null
  const previewBlock = !previewUrl && selectedBlock && selectedBlockCropUrl ? selectedBlock : null

  return (
    <aside className="workspace-document-preview">
      <div className="workspace-document-preview-section">
        {previewUrl ? (
          <div className="artifact-preview workspace-document-preview-frame">
            <iframe src={previewUrl} title={`${document.title || document.filename} PDF preview`} />
          </div>
        ) : (
          <div className="workspace-document-preview-empty preview-empty-state">
            {previewBlock ? (
              <div className="crop-preview workspace-document-preview-placeholder">
                <img src={selectedBlockCropUrl ?? undefined} alt={`Preview crop for block ${previewBlock.order_index + 1}`} />
              </div>
            ) : null}
            <strong>No compiled preview yet</strong>
            <span>
              {previewBlock
                ? 'Showing the selected block crop until a compiled render is available.'
                : 'Compile the document to render a PDF preview. The assembled LaTeX source remains visible below.'}
            </span>
          </div>
        )}
      </div>

      <section className="workspace-document-preview-section workspace-document-source">
        <p className="eyebrow">Block source</p>
        <div className="generated-output workspace-document-preview-source">
          <pre>{blockSource}</pre>
        </div>
      </section>
    </aside>
  )
}
