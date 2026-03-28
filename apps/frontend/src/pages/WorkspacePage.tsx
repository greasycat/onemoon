import { useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { ConversionModeToolbar } from '../components/ConversionModeToolbar'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { FRONTEND_DEBUG } from '../lib/debug'
import { WorkspaceDocumentPreview } from './workspace/WorkspaceDocumentPreview'
import { WorkspacePageSidebar } from './workspace/WorkspacePageSidebar'
import { WorkspaceReviewPanel } from './workspace/WorkspaceReviewPanel'
import { useWorkspaceController } from './workspace/useWorkspaceController'

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const location = useLocation()
  const [isConversionMode, setIsConversionMode] = useState(false)
  const [isConversionModePending, setIsConversionModePending] = useState(false)
  const pendingUploadJobId =
    location.state && typeof location.state === 'object' && 'pendingUploadJobId' in location.state && typeof location.state.pendingUploadJobId === 'string'
      ? location.state.pendingUploadJobId
      : null
  const {
    activePageLocked,
    activeTool,
    applySelectedBlock,
    blockInspectorBusy,
    canvasRef,
    cycleBlockType,
    debugSettings,
    deleteSelectedBlock,
    document,
    documentQuery,
    activeCutCeilingPath,
    hoveredBlockLabel,
    handleCreateBlock,
    handleUpdateBlock,
    pageDraft,
    pageEntries,
    projectName,
    reopenActivePage,
    resetDebugSettings,
    reviewCounts,
    saveActivePage,
    selectedBlock,
    selectedBlockCount,
    selectedBlockIds,
    selectedBlockKey,
    selectedPage,
    selectBlock,
    selectPage,
    setHoveredBlock,
    setViewportState,
    toast,
    toolbar,
    updateDebugSetting,
    viewportState,
    deleteSelectedBlocks,
    duplicateSelectedBlock,
    isResolvingDocumentCreation,
    isWorkspaceInitializing,
  } = useWorkspaceController(documentId, pendingUploadJobId)

  const filenameStem = useMemo(() => {
    if (!document?.filename) {
      return ''
    }
    const extensionIndex = document.filename.lastIndexOf('.')
    return extensionIndex > 0 ? document.filename.slice(0, extensionIndex) : document.filename
  }, [document?.filename])

  if (documentQuery.isLoading || isResolvingDocumentCreation || isWorkspaceInitializing) {
    return (
      <main className="page-shell workspace-loading-shell">
        <div className="panel workspace-loading-panel" role="status" aria-live="polite">
          <div className="workspace-loading-spinner" aria-hidden="true" />
          <p className="workspace-loading-label">Loading workspace…</p>
        </div>
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

  const blockInfoPanel = (
    <BlockInspector
      key={selectedBlockCount > 1 ? `bulk-${selectedBlockCount}` : selectedBlockKey ?? 'empty'}
      block={selectedBlock}
      selectedCount={selectedBlockCount}
      pageLocked={activePageLocked}
      isBusy={blockInspectorBusy}
      onApply={applySelectedBlock}
      onDelete={deleteSelectedBlock}
      onDeleteSelection={deleteSelectedBlocks}
      onDuplicate={duplicateSelectedBlock}
    />
  )
  const blockListPanel = (
    <WorkspaceReviewPanel
      activeBlockId={selectedBlockKey}
      pageDraft={pageDraft}
      selectedBlockIds={selectedBlockIds}
      selectedBlock={selectedBlock}
      selectionCount={selectedBlockCount}
      onSelectBlock={selectBlock}
      onCycleBlockType={cycleBlockType}
    />
  )

  async function handleConversionModeToggle() {
    if (isConversionModePending) {
      return
    }

    setIsConversionModePending(true)
    try {
      if (isConversionMode) {
        const reopened = activePageLocked ? await reopenActivePage() : true
        if (reopened) {
          setIsConversionMode(false)
        }
        return
      }

      const saved = activePageLocked ? true : await saveActivePage()
      if (saved) {
        setIsConversionMode(true)
      }
    } finally {
      setIsConversionModePending(false)
    }
  }

  return (
    <main className="workspace-shell">
      <section className="workspace-grid">
        <WorkspacePageSidebar
          pageEntries={pageEntries}
          reviewCounts={reviewCounts}
          selectedPageId={selectedPage.id}
          onSelectPage={selectPage}
        />

        <div className="workspace-main">
          <div className="workspace-main-layout">
            <section className="panel editor-workbench">
              <div className="editor-workbench-header">
                <div className="editor-workbench-title">
                  <p className="eyebrow">{projectName || 'Project'}</p>
                  <h1>{filenameStem}</h1>
                </div>
                <div className="editor-workbench-actions">
                  <button
                    type="button"
                    className="secondary-button workspace-toolbar-toggle"
                    aria-pressed={isConversionMode}
                    disabled={isConversionModePending}
                    onClick={() => {
                      void handleConversionModeToggle()
                    }}
                  >
                    {isConversionMode ? 'Exit conversion mode' : 'Enter conversion mode'}
                  </button>
                </div>
              </div>
              <div className={`editor-workbench-canvas-layout ${isConversionMode ? 'editor-workbench-canvas-layout-conversion' : ''}`}>
                <div className="editor-workbench-canvas-column editor-workbench-canvas-column-list">
                  <div className="editor-workbench-canvas-side-stack">
                    {blockListPanel}
                    {blockInfoPanel}
                  </div>
                </div>
                <div className="editor-workbench-canvas-shell">
                  <DocumentCanvas
                    ref={canvasRef}
                    page={selectedPage}
                    blocks={pageDraft.blocks}
                    cutCeilingPath={activeCutCeilingPath}
                    debugSettings={debugSettings}
                    toolbar={isConversionMode ? null : toolbar}
                    overlayToolbar={
                      isConversionMode ? (
                        <ConversionModeToolbar
                          zoomPercent={toolbar.zoomPercent}
                          onZoomOut={toolbar.onZoomOut}
                          onZoomIn={toolbar.onZoomIn}
                          onFitPage={toolbar.onFitPage}
                          onResetZoom={toolbar.onResetZoom}
                        />
                      ) : null
                    }
                    disableBlockMovement={isConversionMode}
                    blockListPanel={undefined}
                    blockInfoPanel={undefined}
                    toast={toast}
                    selectedBlockIds={selectedBlockIds}
                    activeBlockId={selectedBlockKey}
                    activeTool={activeTool}
                    isLocked={activePageLocked}
                    onViewportChange={setViewportState}
                    onSelectBlock={selectBlock}
                    onCycleBlockType={cycleBlockType}
                    onHoveredBlockChange={setHoveredBlock}
                    onCreateBlock={handleCreateBlock}
                    onUpdateBlock={handleUpdateBlock}
                  />
                </div>
                {isConversionMode ? (
                  <div className="editor-workbench-canvas-column editor-workbench-canvas-column-preview">
                    <WorkspaceDocumentPreview document={document} />
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </section>
      {FRONTEND_DEBUG ? (
        <WorkspaceDebugToolbar
          settings={debugSettings}
          hoveredBlockLabel={hoveredBlockLabel}
          viewportState={viewportState}
          onChange={updateDebugSetting}
          onReset={resetDebugSettings}
        />
      ) : null}
    </main>
  )
}
