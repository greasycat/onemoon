import { Link, useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { WorkspacePageSidebar } from './workspace/WorkspacePageSidebar'
import { WorkspaceReviewPanel } from './workspace/WorkspaceReviewPanel'
import { useWorkspaceController } from './workspace/useWorkspaceController'

export function WorkspacePage() {
  const { documentId = '' } = useParams()
  const {
    activePageDirty,
    activePageLocked,
    activeReviewStatus,
    activeTool,
    applySelectedBlock,
    blockInspectorBusy,
    canvasRef,
    debugSettings,
    deleteSelectedBlock,
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
    selectedBlockKey,
    selectedBlockLabel,
    selectedPage,
    selectPage,
    setSelectedBlockId,
    setViewportState,
    splitSelectedBlock,
    toast,
    toolbar,
    updateDebugSetting,
    viewportState,
    duplicateSelectedBlock,
  } = useWorkspaceController(documentId)

  if (documentQuery.isLoading) {
    return (
      <main className="page-shell">
        <div className="panel">Loading workspace…</div>
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
              cutCeilingPath={activeCutCeilingPath}
              debugSettings={debugSettings}
              toolbar={toolbar}
              toast={toast}
              tooltipLabel={selectedBlockLabel}
              tooltipText={editorHelperText}
              selectedBlockId={selectedBlockKey}
              activeTool={activeTool}
              isLocked={activePageLocked}
              onViewportChange={setViewportState}
              onSelectBlock={setSelectedBlockId}
              onCreateBlock={handleCreateBlock}
              onUpdateBlock={handleUpdateBlock}
            />
          </section>
        </div>

        <div className="workspace-sidepanels">
          <WorkspaceReviewPanel
            pageDraft={pageDraft}
            selectedBlock={selectedBlock}
            selectedPageLayoutVersion={selectedPage.layout_version}
            viewportState={viewportState}
            onSelectBlock={setSelectedBlockId}
          />

          <BlockInspector
            block={selectedBlock}
            pageLocked={activePageLocked}
            isBusy={blockInspectorBusy}
            onApply={applySelectedBlock}
            onDelete={deleteSelectedBlock}
            onDuplicate={duplicateSelectedBlock}
            onMergePrevious={() => mergeSelectedBlock('previous')}
            onMergeNext={() => mergeSelectedBlock('next')}
            onSplitHorizontal={() => splitSelectedBlock('horizontal')}
            onSplitVertical={() => splitSelectedBlock('vertical')}
          />
        </div>
      </section>
      <WorkspaceDebugToolbar
        settings={debugSettings}
        onChange={updateDebugSetting}
        onReset={resetDebugSettings}
      />
    </main>
  )
}
