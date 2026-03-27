import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas, type CanvasViewportState, type DocumentCanvasHandle } from '../components/DocumentCanvas'
import { PageProgressSummary } from '../components/PageProgressSummary'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { api, withApiRoot } from '../lib/api'
import { useAuth } from '../lib/auth'
import {
  clampGeometry,
  createManualBlock,
  deleteDraftBlock,
  draftBlockKey,
  duplicateDraftBlock,
  geometryFromVertices,
  isPolygonBlock,
  mergeDraftBlock,
  nudgeGeometry,
  pageToDraft,
  reorderDraftBlock,
  splitDraftBlock,
  toPageLayoutPayload,
  translateVertices,
  updateDraftBlock,
  type DraftPageLayout,
} from '../lib/segmentation'
import type { DraftBlock } from '../lib/segmentation'
import type { PageReviewStatus } from '../lib/types'
import type { DocumentDetailResponse } from '../lib/types'
import {
  DEFAULT_WORKSPACE_DEBUG_SETTINGS,
  WORKSPACE_DEBUG_STORAGE_KEY,
  loadWorkspaceDebugSettings,
  normalizeWorkspaceDebugSettings,
  type WorkspaceDebugSettings,
} from '../lib/workspaceDebug'

const POLLABLE_STATUSES = new Set(['uploaded', 'rendering', 'segmenting'])
const LAYOUT_BACKUP_KEY_PREFIX = 'onemoon:layout-backup'

interface WorkspaceToast {
  tone: 'saving' | 'success' | 'error'
  message: string
}

interface SaveLayoutVariables {
  pageId: string
  pageIndex: number
  draft: DraftPageLayout
}

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
  const [selectedBlockId, setSelectedBlockId] = useState<string | null | undefined>(undefined)
  const [activeTool, setActiveTool] = useState<'select' | 'rect' | 'freeform'>('select')
  const [pageDrafts, setPageDrafts] = useState<Record<string, DraftPageLayout>>({})
  const [viewportState, setViewportState] = useState<CanvasViewportState>({
    zoom: 1,
    mode: 'fit-page',
    panX: 0,
    panY: 0,
  })
  const [toast, setToast] = useState<WorkspaceToast | null>(null)
  const [debugSettings, setDebugSettings] = useState<WorkspaceDebugSettings>(() => loadWorkspaceDebugSettings())
  const canvasRef = useRef<DocumentCanvasHandle | null>(null)
  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

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

  const pageEntries = useMemo(() => {
    return (
      document?.pages.map((page) => {
        const draft = pageDrafts[page.id] ?? pageToDraft(page)
        return {
          ...page,
          effectiveReviewStatus: draft.review_status,
          effectiveBlockCount: draft.blocks.length,
          dirty: Boolean(pageDrafts[page.id]),
        }
      }) ?? []
    )
  }, [document, pageDrafts])

  useEffect(() => {
    setSelectedBlockId(undefined)
  }, [activePageId])

  const activeBlockId =
    selectedBlockId === null
      ? null
      : selectedBlockId && pageDraft?.blocks.some((block) => draftBlockKey(block) === selectedBlockId)
        ? selectedBlockId
        : pageDraft?.blocks[0]
          ? draftBlockKey(pageDraft.blocks[0])
          : null

  const selectedBlock = useMemo<DraftBlock | null>(
    () => (activeBlockId ? pageDraft?.blocks.find((block) => draftBlockKey(block) === activeBlockId) ?? null : null),
    [activeBlockId, pageDraft],
  )

  const refreshDocument = async () => {
    await queryClient.invalidateQueries({ queryKey: ['document', token, documentId] })
  }

  function persistLocalLayoutBackup(variables: SaveLayoutVariables) {
    if (typeof window === 'undefined') {
      return
    }
    const storageKey = `${LAYOUT_BACKUP_KEY_PREFIX}:${documentId}:${variables.pageId}`
    const payload = {
      documentId,
      documentTitle: document?.title ?? null,
      pageId: variables.pageId,
      pageIndex: variables.pageIndex,
      savedAt: new Date().toISOString(),
      draft: variables.draft,
    }
    window.localStorage.setItem(storageKey, JSON.stringify(payload))
  }

  function showToast(nextToast: WorkspaceToast, autoHide = true) {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current)
      toastTimeoutRef.current = null
    }
    setToast(nextToast)
    if (!autoHide) {
      return
    }
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimeoutRef.current = null
    }, 2600)
  }

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(WORKSPACE_DEBUG_STORAGE_KEY, JSON.stringify(debugSettings))
  }, [debugSettings])

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
        [selectedPage.id]: updateDraftBlock(pageDraft, draftBlockKey(selectedBlock), (block) => {
          if (isPolygonBlock(block) && block.vertices) {
            const nextGeometry = nudgeGeometry(block.geometry, delta[0], delta[1])
            const moveX = nextGeometry.x - block.geometry.x
            const moveY = nextGeometry.y - block.geometry.y
            const nextVertices = translateVertices(block.vertices, moveX, moveY)
            return {
              ...block,
              geometry: geometryFromVertices(nextVertices),
              vertices: nextVertices,
            }
          }
          return {
            ...block,
            geometry: nudgeGeometry(block.geometry, delta[0], delta[1]),
            vertices: null,
          }
        }),
      }))
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [pageDraft, selectedBlock, selectedPage])

  const saveLayoutMutation = useMutation({
    mutationFn: ({ pageId, draft }: SaveLayoutVariables) =>
      api.savePageLayout(token!, pageId, toPageLayoutPayload(draft)),
    onMutate: (variables) => {
      persistLocalLayoutBackup(variables)
      showToast({ tone: 'saving', message: 'Saving page layout and local copy...' }, false)
    },
    onSuccess: async (_, variables) => {
      setPageDrafts((current) => {
        const next = { ...current }
        delete next[variables.pageId]
        return next
      })
      await refreshDocument()
      showToast({ tone: 'success', message: 'Layout saved. Local copy updated.' })
    },
    onError: (error: Error) => {
      showToast({ tone: 'error', message: error.message || 'Backend save failed. Local copy kept in browser.' })
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
  const activeReviewStatus = pageDraft?.review_status ?? selectedPage?.review_status ?? 'unreviewed'
  const currentPageIndex = selectedPage?.page_index ?? 0
  const reviewCounts = useMemo<Record<PageReviewStatus, number>>(
    () =>
      pageEntries.reduce(
        (counts, page) => {
          counts[page.effectiveReviewStatus] += 1
          return counts
        },
        { unreviewed: 0, in_review: 0, segmented: 0 },
      ),
    [pageEntries],
  )
  const selectedBlockLabel = selectedBlock ? `Selected block: #${selectedBlock.order_index + 1} ${selectedBlock.block_type}` : 'No block selected'
  const reviewActionLabel = activeReviewStatus === 'segmented' ? 'Reopen Page' : activeReviewStatus === 'unreviewed' ? 'Start Review' : null
  const canReviewAction = Boolean(reviewActionLabel) && !pageStatusMutation.isPending && !activePageDirty
  const canMarkSegmented =
    !pageStatusMutation.isPending && !activePageDirty && pageDraft?.blocks.length !== 0 && activeReviewStatus !== 'segmented'
  const editorHelperText = activePageLocked
    ? 'This page is marked segmented. Reopen it to edit the layout.'
    : activeTool === 'rect'
      ? 'Rect mode is active. Drag on the page to create a rectangular block.'
      : activeTool === 'freeform'
        ? 'Free-form mode is active. Draw a closed shape without crossing the stroke.'
      : 'Select mode is active. Drag blocks to move them and use the handles to resize.'

  function updateActiveDraft(updater: (draft: DraftPageLayout) => DraftPageLayout) {
    if (!selectedPage || !pageDraft) {
      return
    }
    setPageDrafts((current) => ({
      ...current,
      [selectedPage.id]: updater(pageDraft),
    }))
  }

  function selectPage(pageId: string) {
    setSelectedPageId(pageId)
    const page = document?.pages.find((candidate) => candidate.id === pageId)
    const firstBlock = page ? (pageDrafts[page.id] ?? pageToDraft(page)).blocks[0] : null
    setSelectedBlockId(firstBlock ? draftBlockKey(firstBlock) : null)
  }

  function handleReviewAction() {
    if (!selectedPage || !reviewActionLabel) {
      return
    }
    pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'reopen' })
  }

  function updateDebugSetting(key: keyof WorkspaceDebugSettings, value: number) {
    setDebugSettings((current) => normalizeWorkspaceDebugSettings({ ...current, [key]: value }))
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
          <span className={`status-chip status-${activeReviewStatus}`}>{activeReviewStatus}</span>
          {activePageDirty ? <span className="status-chip status-pending">unsaved</span> : null}
        </div>
      </header>

      <section className="workspace-grid">
        <div className="page-sidebar panel">
          <PageProgressSummary counts={reviewCounts} />
          <div className="page-list">
            {pageEntries.map((page) => {
              return (
                <button
                  key={page.id}
                  type="button"
                  className={`page-card ${selectedPage.id === page.id ? 'page-card-active' : ''}`}
                  onClick={() => selectPage(page.id)}
                >
                  <img src={withApiRoot(page.image_url) ?? undefined} alt={`Page ${page.page_index + 1}`} />
                  <div>
                    <div className="page-card-title">
                      <strong>Page {page.page_index + 1}</strong>
                      {page.dirty ? <span className="status-dot" /> : null}
                    </div>
                    <p>{page.effectiveBlockCount} blocks</p>
                    <span className={`status-chip status-${page.effectiveReviewStatus}`}>{page.effectiveReviewStatus}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="workspace-main">
          <section className="panel editor-workbench">
            <div className="editor-workbench-header">
              <div className="editor-workbench-title">
                <p className="eyebrow">Manual Segmentation</p>
                <p className="editor-workbench-copy">
                  Refine block boundaries, keep review state moving, and use the canvas as the primary editing surface.
                </p>
              </div>

              <div className="editor-workbench-status">
                <span className={`status-chip status-${activeReviewStatus}`}>{activeReviewStatus.replace('_', ' ')}</span>
                {activePageLocked ? <span className="status-chip status-pending">locked</span> : null}
                {activePageDirty ? <span className="status-chip status-pending">unsaved changes</span> : null}
                <span className="status-chip status-review">{pageDraft.blocks.length} blocks</span>
              </div>
            </div>
            <DocumentCanvas
              ref={canvasRef}
              page={selectedPage}
              blocks={pageDraft.blocks}
              debugSettings={debugSettings}
              toolbar={{
                currentPageIndex,
                totalPages: document.pages.length,
                activeTool,
                activePageLocked,
                isDirty: activePageDirty,
                canGoPrevious: currentPageIndex > 0,
                canGoNext: currentPageIndex < document.pages.length - 1,
                canSave: !activePageLocked && activePageDirty && pageDraft.blocks.length !== 0 && !saveLayoutMutation.isPending,
                canDiscard: activePageDirty,
                canReview: canReviewAction,
                reviewLabel: reviewActionLabel,
                canMarkSegmented,
                zoomPercent: Math.round(viewportState.zoom * 100),
                viewMode: viewportState.mode,
                onPreviousPage: () => {
                  const previousPage = pageEntries[currentPageIndex - 1]
                  if (previousPage) {
                    selectPage(previousPage.id)
                  }
                },
                onNextPage: () => {
                  const nextPage = pageEntries[currentPageIndex + 1]
                  if (nextPage) {
                    selectPage(nextPage.id)
                  }
                },
                onSetTool: setActiveTool,
                onZoomOut: () => canvasRef.current?.zoomOut(),
                onZoomIn: () => canvasRef.current?.zoomIn(),
                onFitPage: () => canvasRef.current?.fitPage(),
                onResetZoom: () => canvasRef.current?.resetZoom(),
                onSave: () =>
                  saveLayoutMutation.mutate({
                    pageId: selectedPage.id,
                    pageIndex: selectedPage.page_index,
                    draft: pageDraft,
                  }),
                onDiscard: () =>
                  setPageDrafts((current) => {
                    const next = { ...current }
                    delete next[selectedPage.id]
                    return next
                  }),
                onReviewAction: handleReviewAction,
                onMarkSegmented: () => pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'mark-segmented' }),
              }}
              toast={toast}
              tooltipLabel={selectedBlockLabel}
              tooltipText={editorHelperText}
              selectedBlockId={selectedBlock ? draftBlockKey(selectedBlock) : null}
              activeTool={activeTool}
              isLocked={activePageLocked}
              onViewportChange={setViewportState}
              onSelectBlock={setSelectedBlockId}
              onCreateBlock={({ shape_type, geometry, vertices }) => {
                const nextBlock = createManualBlock(geometry, { shape_type, vertices })
                updateActiveDraft((draft) => ({
                  ...draft,
                  review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
                  blocks: [...draft.blocks, { ...nextBlock, order_index: draft.blocks.length }],
                }))
                setSelectedBlockId(draftBlockKey(nextBlock))
                setActiveTool('select')
              }}
              onUpdateBlock={(blockId, { geometry, vertices }) => {
                updateActiveDraft((draft) =>
                  updateDraftBlock(draft, blockId, (block) => ({
                    ...block,
                    crop_url: null,
                    warnings: [],
                    geometry: clampGeometry(geometry),
                    vertices: block.shape_type === 'polygon' ? vertices : null,
                  })),
                )
              }}
            />
          </section>
        </div>

        <div className="workspace-sidepanels">
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Page Review</p>
              </div>
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
              <div className="stat-card">
                <span>Zoom</span>
                <strong>{Math.round(viewportState.zoom * 100)}%</strong>
              </div>
              <div className="stat-card">
                <span>View</span>
                <strong>{viewportState.mode}</strong>
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
                  crop_url:
                    block.geometry.x === clampGeometry(payload.geometry).x &&
                    block.geometry.y === clampGeometry(payload.geometry).y &&
                    block.geometry.width === clampGeometry(payload.geometry).width &&
                    block.geometry.height === clampGeometry(payload.geometry).height
                      ? block.crop_url
                      : null,
                  warnings:
                    block.geometry.x === clampGeometry(payload.geometry).x &&
                    block.geometry.y === clampGeometry(payload.geometry).y &&
                    block.geometry.width === clampGeometry(payload.geometry).width &&
                    block.geometry.height === clampGeometry(payload.geometry).height
                      ? block.warnings
                      : [],
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
      <WorkspaceDebugToolbar
        settings={debugSettings}
        onChange={updateDebugSetting}
        onReset={() => setDebugSettings({ ...DEFAULT_WORKSPACE_DEBUG_SETTINGS })}
      />
    </main>
  )
}
