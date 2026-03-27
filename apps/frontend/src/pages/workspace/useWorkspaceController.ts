import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { DocumentCanvasHandle, CanvasViewportState } from '../../components/DocumentCanvas'
import type { EditorToolbarProps } from '../../components/EditorToolbar'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
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
  type DraftBlock,
  type DraftPageLayout,
} from '../../lib/segmentation'
import type {
  BlockApproval,
  BlockGeometry,
  BlockShapeType,
  BlockType,
  BlockVertex,
  DocumentDetailResponse,
  PageReviewStatus,
} from '../../lib/types'
import {
  DEFAULT_WORKSPACE_DEBUG_SETTINGS,
  WORKSPACE_DEBUG_STORAGE_KEY,
  loadWorkspaceDebugSettings,
  normalizeWorkspaceDebugSettings,
  type WorkspaceDebugSettings,
} from '../../lib/workspaceDebug'

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

function hasMatchingGeometry(current: BlockGeometry, next: BlockGeometry) {
  return current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height
}

export function useWorkspaceController(documentId: string) {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null | undefined>(undefined)
  const [activeTool, setActiveTool] = useState<'select' | 'rect' | 'freeform' | 'cut'>('select')
  const [pageDrafts, setPageDrafts] = useState<Record<string, DraftPageLayout>>({})
  const [pageCutCeilings, setPageCutCeilings] = useState<Record<string, BlockVertex[] | null>>({})
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
  const activeCutCeilingPath = selectedPage ? pageCutCeilings[selectedPage.id] ?? null : null

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

  async function refreshDocument() {
    await queryClient.invalidateQueries({ queryKey: ['document', token, documentId] })
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

  function setDraftForPage(pageId: string, draft: DraftPageLayout) {
    setPageDrafts((current) => ({
      ...current,
      [pageId]: draft,
    }))
  }

  function clearDraftForPage(pageId: string) {
    setPageDrafts((current) => {
      if (!current[pageId]) {
        return current
      }
      const next = { ...current }
      delete next[pageId]
      return next
    })
  }

  function clearCutCeilingForPage(pageId: string) {
    setPageCutCeilings((current) => {
      if (!(pageId in current)) {
        return current
      }
      const next = { ...current }
      delete next[pageId]
      return next
    })
  }

  function updateActiveDraft(updater: (draft: DraftPageLayout) => DraftPageLayout) {
    if (!selectedPage || !pageDraft) {
      return
    }
    setDraftForPage(selectedPage.id, updater(pageDraft))
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

      const selectedKey = draftBlockKey(selectedBlock)
      const step = event.shiftKey ? 0.02 : 0.005
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setDraftForPage(selectedPage.id, deleteDraftBlock(pageDraft, selectedKey))
        setSelectedBlockId(null)
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        const duplicated = duplicateDraftBlock(pageDraft, selectedKey)
        setDraftForPage(selectedPage.id, duplicated.draft)
        setSelectedBlockId(duplicated.selectedBlockKey)
        return
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const reordered = reorderDraftBlock(pageDraft, selectedKey, event.key === '[' ? 'up' : 'down')
        setDraftForPage(selectedPage.id, reordered.draft)
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
      setDraftForPage(
        selectedPage.id,
        updateDraftBlock(pageDraft, selectedKey, (block) => {
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
      )
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
      showToast({ tone: 'saving', message: 'Saving page layout and local copy…' }, false)
    },
    onSuccess: async (_, variables) => {
      clearDraftForPage(variables.pageId)
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
      clearDraftForPage(variables.pageId)
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
  const selectedBlockLabel = selectedBlock
    ? `Selected block: #${selectedBlock.order_index + 1} ${selectedBlock.block_type}`
    : 'No block selected'
  const reviewActionLabel =
    activeReviewStatus === 'segmented' ? 'Reopen Page' : activeReviewStatus === 'unreviewed' ? 'Start Review' : null
  const canReviewAction = Boolean(reviewActionLabel) && !pageStatusMutation.isPending && !activePageDirty
  const canMarkSegmented =
    !pageStatusMutation.isPending && !activePageDirty && pageDraft?.blocks.length !== 0 && activeReviewStatus !== 'segmented'
  const editorHelperText = activePageLocked
    ? 'This page is marked segmented. Reopen it to edit the layout.'
    : activeTool === 'rect'
      ? 'Rect mode is active. Drag on the page to create a rectangular block.'
      : activeTool === 'freeform'
        ? 'Free-form mode is active. Draw a closed shape without crossing the stroke.'
        : activeTool === 'cut'
          ? 'Cut mode is active. Draw an open stroke across the page to create the region above the cut.'
        : 'Select mode is active. Drag blocks to move them and use the handles to resize.'

  function selectPage(pageId: string) {
    setSelectedPageId(pageId)
    const page = document?.pages.find((candidate) => candidate.id === pageId)
    const firstBlock = page ? (pageDrafts[page.id] ?? pageToDraft(page)).blocks[0] : null
    setSelectedBlockId(firstBlock ? draftBlockKey(firstBlock) : null)
  }

  function selectRelativePage(offset: number) {
    const nextPage = pageEntries[currentPageIndex + offset]
    if (nextPage) {
      selectPage(nextPage.id)
    }
  }

  function updateDebugSetting(key: keyof WorkspaceDebugSettings, value: number) {
    setDebugSettings((current) => normalizeWorkspaceDebugSettings({ ...current, [key]: value }))
  }

  function resetDebugSettings() {
    setDebugSettings({ ...DEFAULT_WORKSPACE_DEBUG_SETTINGS })
  }

  function saveActivePage() {
    if (!selectedPage || !pageDraft) {
      return
    }
    saveLayoutMutation.mutate({
      pageId: selectedPage.id,
      pageIndex: selectedPage.page_index,
      draft: pageDraft,
    })
  }

  function discardActiveDraft() {
    if (!selectedPage) {
      return
    }
    clearDraftForPage(selectedPage.id)
    clearCutCeilingForPage(selectedPage.id)
  }

  function handleReviewAction() {
    if (!selectedPage || !reviewActionLabel) {
      return
    }
    pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'reopen' })
  }

  function markActivePageSegmented() {
    if (!selectedPage) {
      return
    }
    pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'mark-segmented' })
  }

  function handleCreateBlock(payload: {
    shape_type: BlockShapeType
    geometry: BlockGeometry
    vertices: BlockVertex[] | null
    cut_path?: BlockVertex[] | null
  }) {
    if (!selectedPage) {
      return
    }
    const nextCutPath = payload.cut_path ?? null
    const nextBlock = createManualBlock(payload.geometry, {
      shape_type: payload.shape_type,
      vertices: payload.vertices,
    })
    updateActiveDraft((draft) => ({
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: [...draft.blocks, { ...nextBlock, order_index: draft.blocks.length }],
    }))
    if (nextCutPath) {
      setPageCutCeilings((current) => ({
        ...current,
        [selectedPage.id]: nextCutPath,
      }))
    }
    setSelectedBlockId(draftBlockKey(nextBlock))
    setActiveTool('select')
  }

  function handleUpdateBlock(blockId: string, payload: { geometry: BlockGeometry; vertices: BlockVertex[] | null }) {
    updateActiveDraft((draft) =>
      updateDraftBlock(draft, blockId, (block) => ({
        ...block,
        crop_url: null,
        warnings: [],
        geometry: clampGeometry(payload.geometry),
        vertices: block.shape_type === 'polygon' ? payload.vertices : null,
      })),
    )
  }

  function applySelectedBlock(payload: {
    block_type: BlockType
    approval: BlockApproval
    geometry: BlockGeometry
  }) {
    if (!selectedBlock) {
      return
    }
    const nextGeometry = clampGeometry(payload.geometry)
    updateActiveDraft((draft) =>
      updateDraftBlock(draft, draftBlockKey(selectedBlock), (block) => ({
        ...block,
        block_type: payload.block_type,
        approval: payload.approval,
        crop_url: hasMatchingGeometry(block.geometry, nextGeometry) ? block.crop_url : null,
        warnings: hasMatchingGeometry(block.geometry, nextGeometry) ? block.warnings : [],
        geometry: nextGeometry,
      })),
    )
  }

  function deleteSelectedBlock() {
    if (!selectedBlock) {
      return
    }
    updateActiveDraft((draft) => deleteDraftBlock(draft, draftBlockKey(selectedBlock)))
    setSelectedBlockId(null)
  }

  function duplicateSelectedBlock() {
    if (!selectedPage || !pageDraft || !selectedBlock) {
      return
    }
    const duplicated = duplicateDraftBlock(pageDraft, draftBlockKey(selectedBlock))
    setDraftForPage(selectedPage.id, duplicated.draft)
    setSelectedBlockId(duplicated.selectedBlockKey)
  }

  function mergeSelectedBlock(direction: 'previous' | 'next') {
    if (!selectedPage || !pageDraft || !selectedBlock) {
      return
    }
    const merged = mergeDraftBlock(pageDraft, draftBlockKey(selectedBlock), direction)
    setDraftForPage(selectedPage.id, merged.draft)
    setSelectedBlockId(merged.selectedBlockKey)
  }

  function splitSelectedBlock(direction: 'horizontal' | 'vertical') {
    if (!selectedPage || !pageDraft || !selectedBlock) {
      return
    }
    const split = splitDraftBlock(pageDraft, draftBlockKey(selectedBlock), direction)
    setDraftForPage(selectedPage.id, split.draft)
    setSelectedBlockId(split.selectedBlockKey)
  }

  const toolbar: EditorToolbarProps = {
    currentPageIndex,
    totalPages: document?.pages.length ?? 0,
    activeTool,
    activePageLocked,
    isDirty: activePageDirty,
    canGoPrevious: currentPageIndex > 0,
    canGoNext: currentPageIndex < (document?.pages.length ?? 0) - 1,
    canSave: !activePageLocked && activePageDirty && pageDraft?.blocks.length !== 0 && !saveLayoutMutation.isPending,
    canDiscard: activePageDirty,
    canReview: canReviewAction,
    reviewLabel: reviewActionLabel,
    canMarkSegmented,
    zoomPercent: Math.round(viewportState.zoom * 100),
    viewMode: viewportState.mode,
    onPreviousPage: () => selectRelativePage(-1),
    onNextPage: () => selectRelativePage(1),
    onSetTool: setActiveTool,
    onZoomOut: () => canvasRef.current?.zoomOut(),
    onZoomIn: () => canvasRef.current?.zoomIn(),
    onFitPage: () => canvasRef.current?.fitPage(),
    onResetZoom: () => canvasRef.current?.resetZoom(),
    onSave: saveActivePage,
    onDiscard: discardActiveDraft,
    onReviewAction: handleReviewAction,
    onMarkSegmented: markActivePageSegmented,
  }

  return {
    activePageDirty,
    activePageLocked,
    activeReviewStatus,
    activeTool,
    applySelectedBlock,
    blockInspectorBusy: saveLayoutMutation.isPending || pageStatusMutation.isPending,
    canvasRef,
    debugSettings,
    document,
    documentQuery,
    editorHelperText,
    activeCutCeilingPath,
    handleCreateBlock,
    handleUpdateBlock,
    mergeSelectedBlock,
    pageDraft,
    pageEntries,
    resetDebugSettings,
    reviewCounts,
    selectedBlock,
    selectedBlockKey: selectedBlock ? draftBlockKey(selectedBlock) : null,
    selectedBlockLabel,
    selectedPage,
    selectPage,
    setActiveTool,
    setSelectedBlockId,
    setViewportState,
    splitSelectedBlock,
    toast,
    toolbar,
    updateDebugSetting,
    viewportState,
    deleteSelectedBlock,
    duplicateSelectedBlock,
  }
}
