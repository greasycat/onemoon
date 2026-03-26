type ActiveTool = 'select' | 'create'
type ViewMode = 'fit-page' | 'fit-width' | 'manual'

interface EditorToolbarProps {
  currentPageIndex: number
  totalPages: number
  activeTool: ActiveTool
  activePageLocked: boolean
  isDirty: boolean
  selectedBlockLabel: string
  helperText: string
  canGoPrevious: boolean
  canGoNext: boolean
  canSave: boolean
  canDiscard: boolean
  canReview: boolean
  reviewLabel: string | null
  canMarkSegmented: boolean
  zoomPercent: number
  viewMode: ViewMode
  onPreviousPage: () => void
  onNextPage: () => void
  onSetTool: (tool: ActiveTool) => void
  onZoomOut: () => void
  onZoomIn: () => void
  onFitPage: () => void
  onFitWidth: () => void
  onResetZoom: () => void
  onSave: () => void
  onDiscard: () => void
  onReviewAction: () => void
  onMarkSegmented: () => void
}

export function EditorToolbar({
  currentPageIndex,
  totalPages,
  activeTool,
  activePageLocked,
  isDirty,
  selectedBlockLabel,
  helperText,
  canGoPrevious,
  canGoNext,
  canSave,
  canDiscard,
  canReview,
  reviewLabel,
  canMarkSegmented,
  zoomPercent,
  viewMode,
  onPreviousPage,
  onNextPage,
  onSetTool,
  onZoomOut,
  onZoomIn,
  onFitPage,
  onFitWidth,
  onResetZoom,
  onSave,
  onDiscard,
  onReviewAction,
  onMarkSegmented,
}: EditorToolbarProps) {
  return (
    <section className="editor-toolbar" aria-label="Editor controls">
      <div className="editor-toolbar-row">
        <div className="toolbar-group">
          <div className="toolbar-group-heading">
            <span className="toolbar-kicker">Page Flow</span>
            <div className="toolbar-label">
              <strong>
                Page {currentPageIndex + 1} of {totalPages}
              </strong>
              <span>{isDirty ? 'Unsaved changes on this page' : 'Page state saved'}</span>
            </div>
          </div>
          <div className="toolbar-control-row">
            <button type="button" className="secondary-button" disabled={!canGoPrevious} onClick={onPreviousPage}>
              Prev Page
            </button>
            <button type="button" className="secondary-button" disabled={!canGoNext} onClick={onNextPage}>
              Next Page
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <div className="toolbar-group-heading">
            <span className="toolbar-kicker">Tool</span>
            <div className="toolbar-label toolbar-label-compact">
              <strong>{activeTool === 'create' ? 'Draw mode' : 'Select mode'}</strong>
              <span>{activePageLocked ? 'Locked page' : 'Switch between editing tools'}</span>
            </div>
          </div>
          <div className="toolbar-control-row">
            <button
              type="button"
              className={`pill-button ${activeTool === 'select' ? 'pill-button-active' : ''}`}
              onClick={() => onSetTool('select')}
            >
              Select
            </button>
            <button
              type="button"
              className={`pill-button ${activeTool === 'create' ? 'pill-button-active' : ''}`}
              disabled={activePageLocked}
              onClick={() => onSetTool('create')}
            >
              Draw Block
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <div className="toolbar-group-heading">
            <span className="toolbar-kicker">View</span>
            <div className="toolbar-label toolbar-label-compact">
              <strong>{zoomPercent}%</strong>
              <span>{viewMode === 'manual' ? 'Manual zoom' : viewMode === 'fit-width' ? 'Fit width' : 'Fit page'}</span>
            </div>
          </div>
          <div className="toolbar-control-row">
            <button type="button" className="secondary-button" onClick={onZoomOut}>
              Zoom Out
            </button>
            <button type="button" className="secondary-button" onClick={onZoomIn}>
              Zoom In
            </button>
            <button type="button" className="secondary-button" onClick={onFitPage}>
              Fit Page
            </button>
            <button type="button" className="secondary-button" onClick={onFitWidth}>
              Fit Width
            </button>
            <button type="button" className="secondary-button" onClick={onResetZoom}>
              100%
            </button>
          </div>
        </div>

        <div className="toolbar-group toolbar-group-actions">
          <div className="toolbar-group-heading">
            <span className="toolbar-kicker">Draft</span>
            <div className="toolbar-label">
              <strong>{isDirty ? 'Changes need saving' : 'Draft is synced'}</strong>
              <span>{activePageLocked ? 'Reopen to unlock editing.' : 'Save before changing the page state.'}</span>
            </div>
          </div>
          <div className="toolbar-control-row">
            <button type="button" className="secondary-button" disabled={!canDiscard} onClick={onDiscard}>
              Discard
            </button>
            <button type="button" className="primary-button" disabled={!canSave} onClick={onSave}>
              Save Draft
            </button>
            {reviewLabel ? (
              <button type="button" className="secondary-button" disabled={!canReview} onClick={onReviewAction}>
                {reviewLabel}
              </button>
            ) : null}
            <button type="button" className="secondary-button" disabled={!canMarkSegmented} onClick={onMarkSegmented}>
              Mark Segmented
            </button>
          </div>
        </div>
      </div>

      <div className="editor-toolbar-meta">
        <span className="editor-toolbar-meta-primary">{selectedBlockLabel}</span>
        <span className="muted-text shortcut-note">{helperText}</span>
      </div>
    </section>
  )
}
