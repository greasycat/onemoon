import { useMemo } from 'react'
import { useParams } from 'react-router-dom'

import { BlockInspector } from '../components/BlockInspector'
import { DocumentCanvas } from '../components/DocumentCanvas'
import { WorkspaceDebugToolbar } from '../components/WorkspaceDebugToolbar'
import { FRONTEND_DEBUG } from '../lib/debug'
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
    setViewportState,
    splitSelectedBlock,
    toast,
    toolbar,
    updateDebugSetting,
    viewportState,
    deleteSelectedBlocks,
    duplicateSelectedBlock,
  } = useWorkspaceController(documentId)

  const filenameStem = useMemo(() => {
    if (!document?.filename) {
      return ''
    }
    const extensionIndex = document.filename.lastIndexOf('.')
    return extensionIndex > 0 ? document.filename.slice(0, extensionIndex) : document.filename
  }, [document?.filename])

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
      onMergePrevious={() => mergeSelectedBlock('previous')}
      onMergeNext={() => mergeSelectedBlock('next')}
      onSplitHorizontal={() => splitSelectedBlock('horizontal')}
      onSplitVertical={() => splitSelectedBlock('vertical')}
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
          />
        </div>
      </section>
      {FRONTEND_DEBUG ? (
        <WorkspaceDebugToolbar
          settings={debugSettings}
          onChange={updateDebugSetting}
          onReset={resetDebugSettings}
        />
      ) : null}
    </main>
  )
}
