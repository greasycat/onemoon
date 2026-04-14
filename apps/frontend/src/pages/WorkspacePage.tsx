import { useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { ConversionModeToolbar } from '../components/ConversionModeToolbar'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { WorkspaceModeNavigation, type WorkspaceMode } from '../components/WorkspaceModeNavigation'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { FRONTEND_DEBUG } from '../lib/debug'
import { WorkspaceBlockSourcePanel, WorkspaceDocumentPreview, WorkspaceSourcePreviewPanel } from './workspace/WorkspaceDocumentPreview'
import { WorkspaceMergedCodePanel } from './workspace/WorkspaceMergedCodePanel'
import { WorkspacePageSidebar } from './workspace/WorkspacePageSidebar'
import { WorkspaceReviewPanel } from './workspace/WorkspaceReviewPanel'
import { useWorkspaceController } from './workspace/useWorkspaceController'

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const location = useLocation()
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('review')
  const [isWorkspaceModePending, setIsWorkspaceModePending] = useState(false)
  const pendingUploadJobId =
    location.state && typeof location.state === 'object' && 'pendingUploadJobId' in location.state && typeof location.state.pendingUploadJobId === 'string'
      ? location.state.pendingUploadJobId
      : null
  const {
    activePageLocked,
    activeTool,
    blockInspectorBusy,
    canvasRef,
    conversionInstruction,
    copyMergedCodeToClipboard,
    cycleBlockType,
    convertAllBlocks,
    convertSelectedBlock,
    debugSettings,
    compilePdfState,
    compileAndDownloadPdf,
    downloadMergedPackage,
    document,
    documentQuery,
    activeCutCeilingPath,
    hoveredBlockLabel,
    handleCreateBlock,
    handleUpdateBlock,
    isBulkConverting,
    isDownloadingMergedPackage,
    pageDraft,
    pageEntries,
    projectName,
    mergedDocumentSource,
    isMergingDocument,
    mergeDocument,
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
    setSaveMaskedCropToTmp,
    setViewportState,
    toast,
    toolbar,
    updateDebugSetting,
    updateSelectedBlockInstruction,
    viewportState,
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
  const isConversionMode = workspaceMode === 'conversion'
  const isMergingMode = workspaceMode === 'merging'
  const isFocusedWorkspaceMode = workspaceMode !== 'review'

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

  const blockInfoPanel = isConversionMode ? (
    <BlockInspector
      key={selectedBlockCount > 1 ? `bulk-${selectedBlockCount}` : selectedBlockKey ?? 'empty'}
      block={selectedBlock}
      selectedCount={selectedBlockCount}
      isBusy={blockInspectorBusy}
      conversionInstruction={conversionInstruction}
      onChangeConversionInstruction={updateSelectedBlockInstruction}
      onConvert={() => {
        void convertSelectedBlock()
      }}
    />
  ) : null
  const blockListPanel = (
    <WorkspaceReviewPanel
      activeBlockId={selectedBlockKey}
      canConvertAll={pageDraft.blocks.length > 0 && !blockInspectorBusy}
      isConvertingAll={isBulkConverting}
      isConversionMode={isConversionMode}
      pageDraft={pageDraft}
      selectedBlockIds={selectedBlockIds}
      onConvertAll={() => {
        void convertAllBlocks()
      }}
      onSelectBlock={selectBlock}
      onCycleBlockType={cycleBlockType}
    />
  )

  async function handleWorkspaceModeChange(nextMode: WorkspaceMode) {
    if (isWorkspaceModePending || nextMode === workspaceMode) {
      return
    }

    setIsWorkspaceModePending(true)
    try {
      if (nextMode === 'review') {
        const reopened = activePageLocked ? await reopenActivePage() : true
        if (reopened) {
          setWorkspaceMode('review')
        }
        return
      }

      if (workspaceMode !== 'review') {
        setWorkspaceMode(nextMode)
        return
      }

      const saved = activePageLocked ? true : await saveActivePage()
      if (saved) {
        setWorkspaceMode(nextMode)
      }
    } finally {
      setIsWorkspaceModePending(false)
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
                  <WorkspaceModeNavigation
                    activeMode={workspaceMode}
                    disabled={isWorkspaceModePending}
                    onChangeMode={(nextMode) => {
                      void handleWorkspaceModeChange(nextMode)
                    }}
                  />
                </div>
              </div>
              <div
                className={`editor-workbench-canvas-layout ${isConversionMode ? 'editor-workbench-canvas-layout-conversion' : ''} ${isMergingMode ? 'editor-workbench-canvas-layout-merging' : ''}`}
              >
                {isMergingMode ? (
                  <>
                    <div className="editor-workbench-canvas-column editor-workbench-merging-column">
                      <div className="editor-workbench-merging-stack">
                        <div className="editor-workbench-canvas-shell">
                          <DocumentCanvas
                            ref={canvasRef}
                            page={selectedPage}
                            blocks={pageDraft.blocks}
                            cutCeilingPath={activeCutCeilingPath}
                            debugSettings={debugSettings}
                            toolbar={null}
                            overlayToolbar={
                              <ConversionModeToolbar
                                zoomPercent={toolbar.zoomPercent}
                                onZoomOut={toolbar.onZoomOut}
                                onZoomIn={toolbar.onZoomIn}
                                onFitPage={toolbar.onFitPage}
                                onResetZoom={toolbar.onResetZoom}
                              />
                            }
                            disableBlockMovement
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
                        <WorkspaceSourcePreviewPanel document={document} selectedBlock={selectedBlock} className="workspace-source-preview-panel" />
                        <WorkspaceBlockSourcePanel selectedBlock={selectedBlock} className="workspace-block-source-panel" />
                      </div>
                    </div>
                    <div className="editor-workbench-canvas-column editor-workbench-canvas-column-preview">
                      <WorkspaceMergedCodePanel
                        mergedSource={mergedDocumentSource}
                        isDownloadingPackage={isDownloadingMergedPackage}
                        isMerging={isMergingDocument}
                        onDownload={() => {
                          void downloadMergedPackage()
                        }}
                        onCopy={() => {
                          void copyMergedCodeToClipboard()
                        }}
                        onMerge={(suggestion) => {
                          void mergeDocument(suggestion)
                        }}
                        compilePdfState={compilePdfState}
                        onCompilePdf={() => {
                          void compileAndDownloadPdf()
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="editor-workbench-canvas-column editor-workbench-canvas-column-list">
                      <div
                        className={`editor-workbench-canvas-side-stack ${isConversionMode ? 'editor-workbench-canvas-side-stack-conversion' : ''}`}
                      >
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
                        toolbar={isFocusedWorkspaceMode ? null : toolbar}
                        overlayToolbar={
                          isFocusedWorkspaceMode ? (
                            <ConversionModeToolbar
                              zoomPercent={toolbar.zoomPercent}
                              onZoomOut={toolbar.onZoomOut}
                              onZoomIn={toolbar.onZoomIn}
                              onFitPage={toolbar.onFitPage}
                              onResetZoom={toolbar.onResetZoom}
                            />
                          ) : null
                        }
                        disableBlockMovement={isFocusedWorkspaceMode}
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
                        <WorkspaceDocumentPreview document={document} selectedBlock={selectedBlock} />
                      </div>
                    ) : null}
                  </>
                )}
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
          onToggleSaveMaskedCropToTmp={setSaveMaskedCropToTmp}
          onReset={resetDebugSettings}
        />
      ) : null}
    </main>
  )
}
