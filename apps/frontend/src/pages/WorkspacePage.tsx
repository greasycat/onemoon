import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { api, withApiRoot } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { BlockGeometry, BlockResponse, DocumentDetailResponse } from '../lib/types'

const POLLABLE_STATUSES = new Set(['uploaded', 'rendering', 'segmenting', 'compiling'])

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [latexDraft, setLatexDraft] = useState<string | null>(null)

  const documentQuery = useQuery({
    queryKey: ['document', token, documentId],
    queryFn: () => api.getDocument(token!, documentId),
    enabled: Boolean(token && documentId),
    refetchInterval: (query) => {
      const document = query.state.data as DocumentDetailResponse | undefined
      return document && POLLABLE_STATUSES.has(document.status) ? 2000 : false
    },
  })

  const document = documentQuery.data

  const activePageId =
    selectedPageId && document?.pages.some((page) => page.id === selectedPageId)
      ? selectedPageId
      : document?.pages[0]?.id ?? null

  const selectedPage = useMemo(
    () => document?.pages.find((page) => page.id === activePageId) ?? document?.pages[0] ?? null,
    [activePageId, document],
  )

  const activeBlockId =
    selectedBlockId && selectedPage?.blocks.some((block) => block.id === selectedBlockId)
      ? selectedBlockId
      : selectedPage?.blocks[0]?.id ?? null

  const selectedBlock = useMemo<BlockResponse | null>(
    () =>
      selectedPage?.blocks.find((block) => block.id === activeBlockId) ??
      selectedPage?.blocks[0] ??
      null,
    [activeBlockId, selectedPage],
  )

  const refreshDocument = async () => {
    await queryClient.invalidateQueries({ queryKey: ['document', token, documentId] })
  }

  const blockMutation = useMutation({
    mutationFn: ({ blockId, payload }: { blockId: string; payload: Parameters<typeof api.updateBlock>[2] }) =>
      api.updateBlock(token!, blockId, payload),
    onSuccess: refreshDocument,
  })

  const createBlockMutation = useMutation({
    mutationFn: ({ pageId, geometry }: { pageId: string; geometry: BlockGeometry }) =>
      api.createBlock(token!, pageId, { geometry, block_type: 'unknown' }),
    onSuccess: async (block) => {
      setSelectedBlockId(block.id)
      await refreshDocument()
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: ({ blockId, instruction }: { blockId: string; instruction: string }) =>
      api.regenerateBlock(token!, blockId, instruction),
    onSuccess: refreshDocument,
  })

  const compileMutation = useMutation({
    mutationFn: () => api.compileDocument(token!, documentId),
    onSuccess: refreshDocument,
  })

  const resegmentMutation = useMutation({
    mutationFn: (pageId: string) => api.resegmentPage(token!, pageId),
    onSuccess: refreshDocument,
  })

  const saveLatexMutation = useMutation({
    mutationFn: () => api.updateDocument(token!, documentId, { assembled_latex: latexDraft ?? document?.assembled_latex ?? '' }),
    onSuccess: () => {
      setLatexDraft(null)
      refreshDocument()
    },
  })

  if (documentQuery.isLoading) {
    return <main className="page-shell"><div className="panel">Loading workspace...</div></main>
  }

  if (!document) {
    return <main className="page-shell"><div className="panel">Document not found.</div></main>
  }

  const latestArtifact = document.compile_artifacts[0] ?? null
  const displayedLatex = latexDraft ?? document.assembled_latex ?? ''
  const latexDirty = latexDraft !== null && latexDraft !== (document.assembled_latex ?? '')

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <Link className="back-link" to="/">
            ← Projects
          </Link>
          <p className="eyebrow">{document.filename}</p>
          <h1>{document.title}</h1>
        </div>
        <div className="status-stack">
          <span className={`status-chip status-${document.status}`}>{document.status}</span>
          {document.latest_compile_status ? (
            <span className={`status-chip status-${document.latest_compile_status}`}>{document.latest_compile_status}</span>
          ) : null}
        </div>
      </header>

      <section className="workspace-grid">
        <div className="page-sidebar panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Pages</p>
              <h2>{document.pages.length} page{document.pages.length === 1 ? '' : 's'}</h2>
            </div>
          </div>
          <div className="page-list">
            {document.pages.map((page) => (
              <button
                key={page.id}
                type="button"
                className={`page-card ${selectedPage?.id === page.id ? 'page-card-active' : ''}`}
                onClick={() => {
                  setSelectedPageId(page.id)
                  setSelectedBlockId(page.blocks[0]?.id ?? null)
                }}
              >
                <img src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
                <div>
                  <strong>Page {page.page_index + 1}</strong>
                  <p>{page.blocks.length} blocks</p>
                </div>
              </button>
            ))}
          </div>
          {selectedPage ? (
            <button
              type="button"
              className="secondary-button"
              disabled={resegmentMutation.isPending}
              onClick={() => resegmentMutation.mutate(selectedPage.id)}
            >
              {resegmentMutation.isPending ? 'Re-segmenting...' : 'Re-run page segmentation'}
            </button>
          ) : null}
        </div>

        <div className="workspace-main">
          {selectedPage ? (
            <DocumentCanvas
              page={selectedPage}
              selectedBlockId={selectedBlock?.id ?? null}
              onSelectBlock={setSelectedBlockId}
              onCreateBlock={(geometry) => createBlockMutation.mutate({ pageId: selectedPage.id, geometry })}
              onResizeBlock={(blockId, geometry) => blockMutation.mutate({ blockId, payload: { geometry } })}
            />
          ) : (
            <section className="panel">No page has been rendered yet.</section>
          )}

          <section className="panel latex-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Document</p>
                <h2>Assembled LaTeX</h2>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!latexDirty || saveLatexMutation.isPending}
                  onClick={() => saveLatexMutation.mutate()}
                >
                  {saveLatexMutation.isPending ? 'Saving...' : 'Save LaTeX'}
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={compileMutation.isPending}
                  onClick={() => compileMutation.mutate()}
                >
                  {compileMutation.isPending ? 'Compiling...' : 'Compile preview'}
                </button>
              </div>
            </div>
            <textarea
              className="latex-editor"
              value={displayedLatex}
              onChange={(event) => setLatexDraft(event.target.value)}
              spellCheck={false}
            />
            {latestArtifact ? (
              <div className="artifact-grid">
                <div className="artifact-card">
                  <h3>Latest artifact</h3>
                  <p>Version {latestArtifact.version}</p>
                  <a href={withApiRoot(latestArtifact.tex_url) ?? undefined} target="_blank" rel="noreferrer">
                    Open .tex
                  </a>
                  <a href={withApiRoot(latestArtifact.log_url) ?? undefined} target="_blank" rel="noreferrer">
                    Open compile log
                  </a>
                </div>
                <div className="artifact-preview">
                  {latestArtifact.pdf_url ? (
                    <iframe title="Compiled preview" src={withApiRoot(latestArtifact.pdf_url) ?? undefined} />
                  ) : (
                    <div className="empty-state">
                      PDF preview is unavailable. Open the compile log to see whether compilation was skipped or failed.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="empty-state">Compile the document to create preview artifacts.</div>
            )}
          </section>
        </div>

        <BlockInspector
          key={selectedBlock?.id ?? 'empty'}
          block={selectedBlock}
          isBusy={blockMutation.isPending || regenerateMutation.isPending}
          onSave={(payload) => {
            if (!selectedBlock) {
              return
            }
            blockMutation.mutate({ blockId: selectedBlock.id, payload })
          }}
          onRegenerate={(instruction) => {
            if (!selectedBlock) {
              return
            }
            regenerateMutation.mutate({ blockId: selectedBlock.id, instruction })
          }}
        />
      </section>
    </main>
  )
}
