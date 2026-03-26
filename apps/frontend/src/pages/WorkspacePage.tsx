import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { api, withApiRoot } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  clampGeometry,
  createManualBlock,
  deleteDraftBlock,
  draftBlockKey,
  duplicateDraftBlock,
  mergeDraftBlock,
  nudgeGeometry,
  pageToDraft,
  reorderDraftBlock,
  splitDraftBlock,
  toPageLayoutPayload,
  updateDraftBlock,
  type DraftPageLayout,
} from '../lib/segmentation'
import type { DraftBlock } from '../lib/segmentation'
import type { DocumentDetailResponse } from '../lib/types'

const POLLABLE_STATUSES = new Set(['uploaded', 'rendering', 'segmenting'])

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName.toLowerCase()
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable
}

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<'select' | 'create'>('select')
  const [pageDrafts, setPageDrafts] = useState<Record<string, DraftPageLayout>>({})

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

  const pageDraft = useMemo(() => {
    if (!selectedPage) {
      return null
    }
    return pageDrafts[selectedPage.id] ?? pageToDraft(selectedPage)
  }, [pageDrafts, selectedPage])

  const activeBlockId =
    selectedBlockId && pageDraft?.blocks.some((block) => draftBlockKey(block) === selectedBlockId)
      ? selectedBlockId
      : pageDraft?.blocks[0]
        ? draftBlockKey(pageDraft.blocks[0])
        : null

  const selectedBlock = useMemo<DraftBlock | null>(
    () =>
      pageDraft?.blocks.find((block) => draftBlockKey(block) === activeBlockId) ??
      pageDraft?.blocks[0] ??
      null,
    [activeBlockId, pageDraft],
  )

  const refreshDocument = async () => {
    await queryClient.invalidateQueries({ queryKey: ['document', token, documentId] })
  }

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (Object.keys(pageDrafts).length === 0) {
        return
      }
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [pageDrafts])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!selectedPage || !pageDraft || !selectedBlock || isEditableTarget(event.target)) {
        return
      }
      if (selectedPage.review_status === 'segmented') {
        return
      }

      const step = event.shiftKey ? 0.02 : 0.005
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setPageDrafts((current) => ({
          ...current,
          [selectedPage.id]: deleteDraftBlock(pageDraft, draftBlockKey(selectedBlock)),
        }))
        setSelectedBlockId(null)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        const duplicated = duplicateDraftBlock(pageDraft, draftBlockKey(selectedBlock))
        setPageDrafts((current) => ({ ...current, [selectedPage.id]: duplicated.draft }))
        setSelectedBlockId(duplicated.selectedBlockKey)
        return
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const reordered = reorderDraftBlock(pageDraft, draftBlockKey(selectedBlock), event.key === '[' ? 'up' : 'down')
        setPageDrafts((current) => ({ ...current, [selectedPage.id]: reordered.draft }))
        setSelectedBlockId(reordered.selectedBlockKey)
        return
      }

      const deltaByKey: Record<string, [number, number]> = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      }
      const delta = deltaByKey[event.key]
      if (!delta) {
        return
      }
      event.preventDefault()
      setPageDrafts((current) => ({
        ...current,
        [selectedPage.id]: updateDraftBlock(pageDraft, draftBlockKey(selectedBlock), (block) => ({
          ...block,
          geometry: nudgeGeometry(block.geometry, delta[0], delta[1]),
        })),
      }))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pageDraft, selectedBlock, selectedPage])

  const saveLayoutMutation = useMutation({
    mutationFn: ({ pageId, draft }: { pageId: string; draft: DraftPageLayout }) =>
      api.savePageLayout(token!, pageId, toPageLayoutPayload(draft)),
    onSuccess: async (_, variables) => {
      setPageDrafts((current) => {
        const next = { ...current }
        delete next[variables.pageId]
        return next
      })
      await refreshDocument()
    },
  })

  const pageStatusMutation = useMutation({
    mutationFn: ({ pageId, action }: { pageId: string; action: 'reopen' | 'mark-segmented' }) =>
      action === 'reopen' ? api.reopenPage(token!, pageId) : api.markPageSegmented(token!, pageId),
    onSuccess: async (_, variables) => {
      setPageDrafts((current) => {
        const next = { ...current }
        delete next[variables.pageId]
        return next
      })
      await refreshDocument()
    },
  })

  const activePageDirty = selectedPage ? Boolean(pageDrafts[selectedPage.id]) : false
  const activePageLocked = selectedPage?.review_status === 'segmented'

  function updateActiveDraft(updater: (draft: DraftPageLayout) => DraftPageLayout) {
    if (!selectedPage || !pageDraft) {
      return
    }
    setPageDrafts((current) => ({
      ...current,
      [selectedPage.id]: updater(pageDraft),
    }))
  }

  if (documentQuery.isLoading) {
    return (
      <main className="page-shell">
        <div className="panel">Loading workspace...</div>
      </main>
    )
  }

  if (!document || !selectedPage || !pageDraft) {
    return (
      <main className="page-shell">
        <div className="panel">Document not found.</div>
      </main>
    )
  }

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
          <span className={`status-chip status-${selectedPage.review_status}`}>{selectedPage.review_status}</span>
          {activePageDirty ? <span className="status-chip status-pending">unsaved</span> : null}
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
            {document.pages.map((page) => {
              const dirty = Boolean(pageDrafts[page.id])
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`page-card ${selectedPage.id === page.id ? 'page-card-active' : ''}`}
                  onClick={() => {
                    setSelectedPageId(page.id)
                    const firstBlock = (pageDrafts[page.id] ?? pageToDraft(page)).blocks[0]
                    setSelectedBlockId(firstBlock ? draftBlockKey(firstBlock) : null)
                  }}
                >
                  <img src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
                  <div>
                    <div className="page-card-title">
                      <strong>Page {page.page_index + 1}</strong>
                      {dirty ? <span className="status-dot" /> : null}
                    </div>
                    <p>{(pageDrafts[page.id] ?? pageToDraft(page)).blocks.length} blocks</p>
                    <span className={`status-chip status-${page.review_status}`}>{page.review_status}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="workspace-main">
          <section className="panel tool-panel">
            <div className="tool-row">
              <button
                type="button"
                className={`pill-button ${activeTool === 'select' ? 'pill-button-active' : ''}`}
                onClick={() => setActiveTool('select')}
              >
                Select
              </button>
              <button
                type="button"
                className={`pill-button ${activeTool === 'create' ? 'pill-button-active' : ''}`}
                disabled={activePageLocked}
                onClick={() => setActiveTool('create')}
              >
                Draw Block
              </button>
              <span className="muted-text shortcut-note">
                Keys: Delete, arrows, Shift+arrows, Cmd/Ctrl+D, [, ]
              </span>
            </div>
          </section>

          <DocumentCanvas
            page={selectedPage}
            blocks={pageDraft.blocks}
            selectedBlockId={selectedBlock ? draftBlockKey(selectedBlock) : null}
            activeTool={activeTool}
            isLocked={activePageLocked}
            onSelectBlock={setSelectedBlockId}
            onCreateBlock={(geometry) => {
              const nextBlock = createManualBlock(geometry)
              updateActiveDraft((draft) => ({
                ...draft,
                review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
                blocks: [...draft.blocks, { ...nextBlock, order_index: draft.blocks.length }],
              }))
              setSelectedBlockId(draftBlockKey(nextBlock))
              setActiveTool('select')
            }}
            onUpdateBlockGeometry={(blockId, geometry) => {
              updateActiveDraft((draft) =>
                updateDraftBlock(draft, blockId, (block) => ({
                  ...block,
                  geometry: clampGeometry(geometry),
                })),
              )
            }}
          />
        </div>

        <div className="workspace-sidepanels">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Page Review</p>
                <h2>Layout Draft</h2>
              </div>
            </div>
            <div className="button-grid">
              <button
                type="button"
                className="primary-button"
                disabled={!activePageDirty || saveLayoutMutation.isPending || activePageLocked}
                onClick={() => saveLayoutMutation.mutate({ pageId: selectedPage.id, draft: pageDraft })}
              >
                {saveLayoutMutation.isPending ? 'Saving...' : 'Save Draft'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={!activePageDirty}
                onClick={() =>
                  setPageDrafts((current) => {
                    const next = { ...current }
                    delete next[selectedPage.id]
                    return next
                  })
                }
              >
                Discard Draft
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={pageStatusMutation.isPending || activePageDirty}
                onClick={() =>
                  pageStatusMutation.mutate({
                    pageId: selectedPage.id,
                    action: selectedPage.review_status === 'segmented' ? 'reopen' : 'reopen',
                  })
                }
              >
                {selectedPage.review_status === 'segmented' ? 'Reopen Page' : 'Start Review'}
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={
                  pageStatusMutation.isPending ||
                  activePageDirty ||
                  pageDraft.blocks.length === 0 ||
                  selectedPage.review_status === 'segmented'
                }
                onClick={() => pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'mark-segmented' })}
              >
                Mark Segmented
              </button>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span>Blocks</span>
                <strong>{pageDraft.blocks.length}</strong>
              </div>
              <div className="stat-card">
                <span>Layout Version</span>
                <strong>{selectedPage.layout_version}</strong>
              </div>
            </div>
            <div className="block-list">
              {pageDraft.blocks.map((block) => {
                const blockKey = draftBlockKey(block)
                const isSelected = selectedBlock ? draftBlockKey(selectedBlock) === blockKey : false
                return (
                  <button
                    key={blockKey}
                    type="button"
                    className={`block-list-item ${isSelected ? 'block-list-item-active' : ''}`}
                    onClick={() => setSelectedBlockId(blockKey)}
                  >
                    <div>
                      <strong>
                        #{block.order_index + 1} {block.block_type}
                      </strong>
                      <p>{block.approval}</p>
                    </div>
                    <span className={`status-chip status-${block.approval}`}>{block.approval}</span>
                  </button>
                )
              })}
            </div>
          </section>

          <BlockInspector
            key={selectedBlock ? draftBlockKey(selectedBlock) : 'empty'}
            block={selectedBlock}
            pageLocked={activePageLocked}
            isBusy={saveLayoutMutation.isPending || pageStatusMutation.isPending}
            onApply={(payload) => {
              if (!selectedBlock) {
                return
              }
              updateActiveDraft((draft) =>
                updateDraftBlock(draft, draftBlockKey(selectedBlock), (block) => ({
                  ...block,
                  block_type: payload.block_type,
                  approval: payload.approval,
                  geometry: clampGeometry(payload.geometry),
                })),
              )
            }}
            onDelete={() => {
              if (!selectedBlock) {
                return
              }
              updateActiveDraft((draft) => deleteDraftBlock(draft, draftBlockKey(selectedBlock)))
              setSelectedBlockId(null)
            }}
            onDuplicate={() => {
              if (!selectedBlock) {
                return
              }
              const duplicated = duplicateDraftBlock(pageDraft, draftBlockKey(selectedBlock))
              setPageDrafts((current) => ({ ...current, [selectedPage.id]: duplicated.draft }))
              setSelectedBlockId(duplicated.selectedBlockKey)
            }}
            onMergePrevious={() => {
              if (!selectedBlock) {
                return
              }
              const merged = mergeDraftBlock(pageDraft, draftBlockKey(selectedBlock), 'previous')
              setPageDrafts((current) => ({ ...current, [selectedPage.id]: merged.draft }))
              setSelectedBlockId(merged.selectedBlockKey)
            }}
            onMergeNext={() => {
              if (!selectedBlock) {
                return
              }
              const merged = mergeDraftBlock(pageDraft, draftBlockKey(selectedBlock), 'next')
              setPageDrafts((current) => ({ ...current, [selectedPage.id]: merged.draft }))
              setSelectedBlockId(merged.selectedBlockKey)
            }}
            onSplitHorizontal={() => {
              if (!selectedBlock) {
                return
              }
              const split = splitDraftBlock(pageDraft, draftBlockKey(selectedBlock), 'horizontal')
              setPageDrafts((current) => ({ ...current, [selectedPage.id]: split.draft }))
              setSelectedBlockId(split.selectedBlockKey)
            }}
            onSplitVertical={() => {
              if (!selectedBlock) {
                return
              }
              const split = splitDraftBlock(pageDraft, draftBlockKey(selectedBlock), 'vertical')
              setPageDrafts((current) => ({ ...current, [selectedPage.id]: split.draft }))
              setSelectedBlockId(split.selectedBlockKey)
            }}
          />
        </div>
      </section>
    </main>
  )
}
