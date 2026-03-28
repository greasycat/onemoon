import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { FRONTEND_DEBUG } from '../lib/debug'
import { WorkspacePageSidebar } from './workspace/WorkspacePageSidebar'
import { WorkspaceReviewPanel } from './workspace/WorkspaceReviewPanel'
import { useWorkspaceController } from './workspace/useWorkspaceController'

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const location = useLocation()
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
    editorHelperText,
    activeCutCeilingPath,
    hoveredBlockLabel,
    handleCreateBlock,
    handleUpdateBlock,
    pageDraft,
    pageEntries,
    projectName,
    resetDebugSettings,
    reviewCounts,
    selectedBlock,
    selectedBlockCount,
    selectedBlockIds,
    selectedBlockKey,
    selectedBlockLabel,
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
          <section className="panel editor-workbench">
            <div className="editor-workbench-header">
              <div className="editor-workbench-title">
                <p className="eyebrow">{projectName || 'Project'}</p>
                <h1>{filenameStem}</h1>
              </div>
            </div>
            <DocumentCanvas
              ref={canvasRef}
              page={selectedPage}
              blocks={pageDraft.blocks}
              cutCeilingPath={activeCutCeilingPath}
              debugSettings={debugSettings}
              toolbar={toolbar}
              blockInfoPanel={blockInfoPanel}
              toast={toast}
              tooltipLabel={selectedBlockLabel}
              tooltipText={editorHelperText}
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
          </section>
        </div>

        <div className="workspace-sidepanels">
          <WorkspaceReviewPanel
            activeBlockId={selectedBlockKey}
            pageDraft={pageDraft}
            selectedBlockIds={selectedBlockIds}
            selectedBlock={selectedBlock}
            selectionCount={selectedBlockCount}
            selectedPageLayoutVersion={selectedPage.layout_version}
            viewportState={viewportState}
            onSelectBlock={selectBlock}
            onCycleBlockType={cycleBlockType}
          />
        </div>
      </section>
      {FRONTEND_DEBUG ? (
        <WorkspaceDebugToolbar
          settings={debugSettings}
          hoveredBlockLabel={hoveredBlockLabel}
          onChange={updateDebugSetting}
          onReset={resetDebugSettings}
        />
      ) : null}
    </main>
  )
}
