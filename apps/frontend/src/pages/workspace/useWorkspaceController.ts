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
  deleteDraftBlocks,
  draftBlockKey,
  duplicateDraftBlock,
  getLatestDraftCutPath,
  geometryFromVertices,
  isPolygonBlock,
  nudgeGeometry,
  pageToDraft,
  reorderDraftBlock,
  toPageLayoutPayload,
  translateVertices,
  updateDraftBlock,
  type DraftBlock,
  type DraftPageLayout,
} from '../../lib/segmentation'
import type {
  BlockGeometry,
  BlockSelectionMode,
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
const DOCUMENT_CREATION_GRACE_MS = 20_000
const LAYOUT_BACKUP_KEY_PREFIX = 'onemoon:layout-backup'
const TOOL_SHORTCUTS: Record<string, 'select' | 'rect' | 'freeform' | 'cut'> = {
  c: 'cut',
  f: 'freeform',
  p: 'select',
  r: 'rect',
}

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

const EMPTY_PAGE_ACTION_MESSAGE = 'Nothing is created.'

function isDocumentPendingCreationError(error: unknown) {
  return error instanceof Error && (error.message === 'Document not found' || error.message === 'Not Found')
}

function normalizeSelectedBlockKeys(pageDraft: DraftPageLayout | null, selectedBlockKeys: string[] | null | undefined) {
  if (selectedBlockKeys === null) {
    return []
  }

  const pageBlockKeys = pageDraft?.blocks.map((block) => draftBlockKey(block)) ?? []
  if (pageBlockKeys.length === 0) {
    return []
  }

  if (selectedBlockKeys === undefined) {
    return [pageBlockKeys[0]]
  }

  const allowedKeys = new Set(pageBlockKeys)
  const filteredKeys = selectedBlockKeys.filter((blockKey, index) => allowedKeys.has(blockKey) && selectedBlockKeys.indexOf(blockKey) === index)
  return filteredKeys.length > 0 ? filteredKeys : [pageBlockKeys[0]]
}

function prioritizeSelectedBlock(blockKeys: string[], activeBlockKey: string) {
  return [...blockKeys.filter((blockKey) => blockKey !== activeBlockKey), activeBlockKey]
}

export function useWorkspaceController(documentId: string) {
  const { token } = useAuth()
  const queryClient = useQueryClient()
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<string[] | null | undefined>(undefined)
  const [selectionAnchorKey, setSelectionAnchorKey] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState<'select' | 'rect' | 'freeform' | 'cut'>('select')
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
  const documentResolveStartedAtRef = useRef(Date.now())
  const toastTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const [documentCreationTimedOut, setDocumentCreationTimedOut] = useState(false)

  const documentQuery = useQuery({
    queryKey: ['document', token, documentId],
    queryFn: () => api.getDocument(token!, documentId),
    enabled: Boolean(token && documentId),
    retry: (failureCount, error) => {
      if (!isDocumentPendingCreationError(error)) {
        return failureCount < 1
      }
      return Date.now() - documentResolveStartedAtRef.current < DOCUMENT_CREATION_GRACE_MS
    },
    refetchInterval: (query) => {
      const document = query.state.data as DocumentDetailResponse | undefined
      if (document && POLLABLE_STATUSES.has(document.status)) {
        return 2000
      }
      return isDocumentPendingCreationError(query.state.error) ? 2000 : false
    },
  })

  const projectsQuery = useQuery({
    queryKey: ['projects', token],
    queryFn: () => api.getProjects(token!),
    enabled: Boolean(token),
  })

  const document = documentQuery.data
  const isResolvingDocumentCreation =
    !documentCreationTimedOut &&
    !document &&
    isDocumentPendingCreationError(documentQuery.error)
  const projectName = useMemo(
    () => projectsQuery.data?.find((project) => project.id === document?.project_id)?.name ?? '',
    [document?.project_id, projectsQuery.data],
  )
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
  const activeCutCeilingPath = pageDraft ? getLatestDraftCutPath(pageDraft) : null

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

  const activeSelectedBlockKeys = useMemo(
    () => normalizeSelectedBlockKeys(pageDraft, selectedBlockKeys),
    [pageDraft, selectedBlockKeys],
  )
  const activeBlockId = activeSelectedBlockKeys[activeSelectedBlockKeys.length - 1] ?? null

  const selectedBlock = useMemo<DraftBlock | null>(
    () => (activeBlockId ? pageDraft?.blocks.find((block) => draftBlockKey(block) === activeBlockId) ?? null : null),
    [activeBlockId, pageDraft],
  )

  function setSelectedBlockIds(blockIds: string[] | null | undefined) {
    setSelectedBlockKeys(blockIds)
    const nextAnchorKey = blockIds && blockIds.length > 0 ? blockIds[blockIds.length - 1] : null
    setSelectionAnchorKey(nextAnchorKey)
  }

  function selectSingleBlock(blockId: string | null | undefined) {
    setSelectedBlockIds(blockId ? [blockId] : null)
  }

  function selectBlock(blockId: string | null, mode: BlockSelectionMode = 'replace') {
    if (!pageDraft) {
      setSelectedBlockIds(blockId ? [blockId] : null)
      return
    }

    if (!blockId) {
      setSelectedBlockIds(null)
      return
    }

    const pageBlockKeys = pageDraft.blocks.map((block) => draftBlockKey(block))
    if (!pageBlockKeys.includes(blockId)) {
      return
    }

    const currentSelection = normalizeSelectedBlockKeys(pageDraft, selectedBlockKeys)
    if (mode === 'toggle') {
      if (currentSelection.includes(blockId)) {
        const remaining = currentSelection.filter((candidate) => candidate !== blockId)
        setSelectedBlockIds(remaining.length > 0 ? remaining : null)
        return
      }
      setSelectedBlockIds([...currentSelection, blockId])
      return
    }

    if (mode === 'range') {
      const anchorKey =
        selectionAnchorKey && pageBlockKeys.includes(selectionAnchorKey)
          ? selectionAnchorKey
          : activeBlockId && pageBlockKeys.includes(activeBlockId)
            ? activeBlockId
            : blockId
      const anchorIndex = pageBlockKeys.indexOf(anchorKey)
      const targetIndex = pageBlockKeys.indexOf(blockId)
      if (anchorIndex < 0 || targetIndex < 0) {
        setSelectedBlockIds([blockId])
        return
      }
      const nextSelection = pageBlockKeys.slice(
        Math.min(anchorIndex, targetIndex),
        Math.max(anchorIndex, targetIndex) + 1,
      )
      setSelectedBlockKeys(prioritizeSelectedBlock(nextSelection, blockId))
      setSelectionAnchorKey(anchorKey)
      return
    }

    setSelectedBlockIds([blockId])
  }

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
    documentResolveStartedAtRef.current = Date.now()
    setDocumentCreationTimedOut(false)
  }, [documentId])

  useEffect(() => {
    if (!isResolvingDocumentCreation) {
      return
    }
    const remaining = DOCUMENT_CREATION_GRACE_MS - (Date.now() - documentResolveStartedAtRef.current)
    if (remaining <= 0) {
      setDocumentCreationTimedOut(true)
      return
    }
    const timeoutId = window.setTimeout(() => {
      setDocumentCreationTimedOut(true)
    }, remaining)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isResolvingDocumentCreation])

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
  const selectedBlockLabel =
    activeSelectedBlockKeys.length > 1
      ? `${activeSelectedBlockKeys.length} blocks selected`
      : selectedBlock
        ? `Selected block: #${selectedBlock.order_index + 1} ${selectedBlock.block_type}`
        : 'No block selected'
  const reviewActionLabel =
    activeReviewStatus === 'segmented' ? 'Reopen Page' : activeReviewStatus === 'unreviewed' ? 'Start Review' : null
  const canReviewAction = Boolean(reviewActionLabel) && !pageStatusMutation.isPending && !activePageDirty
  const activePageHasNoBlocks = (pageDraft?.blocks.length ?? 0) === 0
  const allowEmptyPageActionToast = !activePageLocked && activePageHasNoBlocks
  const canMarkSegmented =
    !pageStatusMutation.isPending &&
    !activePageDirty &&
    activeReviewStatus !== 'segmented' &&
    (!activePageHasNoBlocks || allowEmptyPageActionToast)
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
    selectSingleBlock(firstBlock ? draftBlockKey(firstBlock) : null)
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
    if (!selectedPage || !pageDraft || activePageLocked || saveLayoutMutation.isPending) {
      return
    }
    if (pageDraft.blocks.length === 0) {
      showToast({ tone: 'error', message: EMPTY_PAGE_ACTION_MESSAGE })
      return
    }
    saveLayoutMutation.mutate({
      pageId: selectedPage.id,
      pageIndex: selectedPage.page_index,
      draft: pageDraft,
    })
  }

  function discardActiveDraft() {
    if (!selectedPage || !pageDraft) {
      return
    }
    if (pageDraft.blocks.length === 0) {
      showToast({ tone: 'error', message: EMPTY_PAGE_ACTION_MESSAGE })
      return
    }
    clearDraftForPage(selectedPage.id)
  }

  function handleReviewAction() {
    if (!selectedPage || !reviewActionLabel) {
      return
    }
    pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'reopen' })
  }

  function markActivePageSegmented() {
    if (!selectedPage || !pageDraft || !canMarkSegmented) {
      return
    }
    if (pageDraft.blocks.length === 0) {
      showToast({ tone: 'error', message: EMPTY_PAGE_ACTION_MESSAGE })
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
      cut_path: nextCutPath,
    })
    updateActiveDraft((draft) => ({
      ...draft,
      review_status: draft.review_status === 'unreviewed' ? 'in_review' : draft.review_status,
      blocks: [...draft.blocks, { ...nextBlock, order_index: draft.blocks.length }],
    }))
    selectSingleBlock(draftBlockKey(nextBlock))
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
        crop_url: hasMatchingGeometry(block.geometry, nextGeometry) ? block.crop_url : null,
        warnings: hasMatchingGeometry(block.geometry, nextGeometry) ? block.warnings : [],
        geometry: nextGeometry,
      })),
    )
  }

  function deleteSelectedBlocks() {
    if (!selectedPage || !pageDraft || activeSelectedBlockKeys.length === 0) {
      return
    }
    setDraftForPage(selectedPage.id, deleteDraftBlocks(pageDraft, activeSelectedBlockKeys))
    setSelectedBlockIds(null)
  }

  function deleteSelectedBlock() {
    if (!selectedBlock || !selectedPage || !pageDraft) {
      return
    }
    setDraftForPage(selectedPage.id, deleteDraftBlock(pageDraft, draftBlockKey(selectedBlock)))
    setSelectedBlockIds(null)
  }

  function duplicateSelectedBlock() {
    if (!selectedPage || !pageDraft || !selectedBlock) {
      return
    }
    const duplicated = duplicateDraftBlock(pageDraft, draftBlockKey(selectedBlock))
    setDraftForPage(selectedPage.id, duplicated.draft)
    selectSingleBlock(duplicated.selectedBlockKey)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!selectedPage || !pageDraft || isEditableTarget(event.target)) {
        return
      }

      const pageLocked = selectedPage.review_status === 'segmented'
      const key = event.key.toLowerCase()
      const hasModifier = event.metaKey || event.ctrlKey
      if (hasModifier && key === 's') {
        event.preventDefault()
        if (!pageLocked && !saveLayoutMutation.isPending) {
          if (pageDraft.blocks.length === 0) {
            showToast({ tone: 'error', message: EMPTY_PAGE_ACTION_MESSAGE })
          } else {
            saveLayoutMutation.mutate({
              pageId: selectedPage.id,
              pageIndex: selectedPage.page_index,
              draft: pageDraft,
            })
          }
        }
        return
      }

      if (hasModifier && event.key === 'Enter') {
        event.preventDefault()
        if (canMarkSegmented) {
          pageStatusMutation.mutate({ pageId: selectedPage.id, action: 'mark-segmented' })
        }
        return
      }

      if (!hasModifier && !event.altKey && key === 's') {
        event.preventDefault()
        if (!pageLocked && !saveLayoutMutation.isPending) {
          if (pageDraft.blocks.length === 0) {
            showToast({ tone: 'error', message: EMPTY_PAGE_ACTION_MESSAGE })
          } else {
            saveLayoutMutation.mutate({
              pageId: selectedPage.id,
              pageIndex: selectedPage.page_index,
              draft: pageDraft,
            })
          }
        }
        return
      }

      if (!hasModifier && !event.altKey) {
        const nextTool = TOOL_SHORTCUTS[key]
        if (nextTool && (!pageLocked || nextTool === 'select')) {
          event.preventDefault()
          setActiveTool(nextTool)
          return
        }
      }

      if (pageLocked) {
        return
      }

      if (activeSelectedBlockKeys.length === 0) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        setDraftForPage(selectedPage.id, deleteDraftBlocks(pageDraft, activeSelectedBlockKeys))
        setSelectedBlockIds(null)
        return
      }

      if (activeSelectedBlockKeys.length !== 1 || !selectedBlock) {
        return
      }

      const selectedKey = draftBlockKey(selectedBlock)
      const step = event.shiftKey ? 0.02 : 0.005
      if (hasModifier && key === 'd') {
        event.preventDefault()
        const duplicated = duplicateDraftBlock(pageDraft, selectedKey)
        setDraftForPage(selectedPage.id, duplicated.draft)
        setSelectedBlockIds([duplicated.selectedBlockKey])
        return
      }
      if (event.key === '[' || event.key === ']') {
        event.preventDefault()
        const reordered = reorderDraftBlock(pageDraft, selectedKey, event.key === '[' ? 'up' : 'down')
        setDraftForPage(selectedPage.id, reordered.draft)
        setSelectedBlockIds([reordered.selectedBlockKey])
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
  }, [
    activeSelectedBlockKeys,
    canMarkSegmented,
    pageDraft,
    pageStatusMutation,
    saveLayoutMutation,
    selectedBlock,
    selectedPage,
  ])

  const toolbar: EditorToolbarProps = {
    currentPageIndex,
    totalPages: document?.pages.length ?? 0,
    activeTool,
    activePageLocked,
    isDirty: activePageDirty,
    canGoPrevious: currentPageIndex > 0,
    canGoNext: currentPageIndex < (document?.pages.length ?? 0) - 1,
    canSave: !activePageLocked && !saveLayoutMutation.isPending && (activePageDirty || allowEmptyPageActionToast),
    canDiscard: activePageDirty || allowEmptyPageActionToast,
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
    isResolvingDocumentCreation,
    editorHelperText,
    activeCutCeilingPath,
    handleCreateBlock,
    handleUpdateBlock,
    pageDraft,
    pageEntries,
    projectName,
    resetDebugSettings,
    reviewCounts,
    selectedBlock,
    selectedBlockIds: activeSelectedBlockKeys,
    selectedBlockCount: activeSelectedBlockKeys.length,
    selectedBlockKey: activeBlockId,
    selectedBlockLabel,
    selectedPage,
    selectPage,
    selectBlock,
    setActiveTool,
    setViewportState,
    toast,
    toolbar,
    updateDebugSetting,
    viewportState,
    deleteSelectedBlock,
    deleteSelectedBlocks,
    duplicateSelectedBlock,
  }
}
