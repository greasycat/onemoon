type ActiveTool = 'select' | 'rect' | 'freeform' | 'cut'
type ViewMode = 'fit-page' | 'fit-width' | 'manual'

function reviewIcon(label: string) {
  return label === 'Reopen Page' ? '↺' : '▶'
}

function reviewShortLabel(label: string) {
  return label === 'Reopen Page' ? 'Reopen' : 'Review'
}

interface ToolbarButtonProps {
  className: string
  label: string
  icon: string
  ariaLabel: string
  title: string
  disabled?: boolean
  onClick: () => void
}

function ToolbarButton({ className, label, icon, ariaLabel, title, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button type="button" className={className} aria-label={ariaLabel} title={title} disabled={disabled} onClick={onClick}>
      <span className="toolbar-button-text">{label}</span>
      <span className="toolbar-button-icon" aria-hidden="true">
        {icon}
      </span>
    </button>
  )
}

interface ToolbarSectionBreakProps {
  label: string
}

function ToolbarSectionBreak({ label }: ToolbarSectionBreakProps) {
  return (
    <div className="toolbar-section-break" aria-hidden="true">
      <div className="toolbar-divider" />
      <span className="toolbar-group-caption">{label}</span>
    </div>
  )
}

export interface EditorToolbarProps {
  currentPageIndex: number
  totalPages: number
  activeTool: ActiveTool
  activePageLocked: boolean
  isDirty: boolean
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
  onResetZoom,
  onSave,
  onDiscard,
  onReviewAction,
  onMarkSegmented,
}: EditorToolbarProps) {
  return (
    <section className="editor-toolbar" aria-label="Editor controls">
      <div className="editor-toolbar-status-strip">
        <span className="toolbar-status-pill">
          Page {currentPageIndex + 1}/{totalPages}
        </span>
        <span className="toolbar-status-pill">{zoomPercent}%</span>
        <span className="toolbar-status-pill">{viewMode === 'manual' ? 'Manual' : viewMode === 'fit-width' ? 'Fit width' : 'Fit page'}</span>
        <span className={`toolbar-status-pill ${isDirty ? 'toolbar-status-pill-accent' : ''}`}>
          {isDirty ? 'Unsaved' : 'Synced'}
        </span>
      </div>

      <div className="editor-toolbar-row">
        <div className="toolbar-button-cluster" aria-label="Page navigation">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Prev"
            icon="←"
            ariaLabel="Previous page"
            title="Previous page"
            disabled={!canGoPrevious}
            onClick={onPreviousPage}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Next"
            icon="→"
            ariaLabel="Next page"
            title="Next page"
            disabled={!canGoNext}
            onClick={onNextPage}
          />
        </div>

        <ToolbarSectionBreak label="Blocks" />

        <div className="toolbar-button-cluster" aria-label="Block tools">
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'select' ? 'pill-button-active' : ''}`}
            label="Pick"
            icon="↖"
            ariaLabel="Select tool"
            title="Select tool"
            onClick={() => onSetTool('select')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'rect' ? 'pill-button-active' : ''}`}
            label="Rect"
            icon="✎"
            ariaLabel="Draw rectangle block"
            title="Draw rectangle block"
            disabled={activePageLocked}
            onClick={() => onSetTool('rect')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'freeform' ? 'pill-button-active' : ''}`}
            label="Free"
            icon="⌁"
            ariaLabel="Draw free-form block"
            title="Draw free-form block"
            disabled={activePageLocked}
            onClick={() => onSetTool('freeform')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'cut' ? 'pill-button-active' : ''}`}
            label="Cut"
            icon="≈"
            ariaLabel="Draw cut block"
            title="Draw cut block"
            disabled={activePageLocked}
            onClick={() => onSetTool('cut')}
          />
        </div>

        <ToolbarSectionBreak label="Zoom" />

        <div className="toolbar-button-cluster" aria-label="Zoom controls">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Out"
            icon="−"
            ariaLabel="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="In"
            icon="+"
            ariaLabel="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Fit"
            icon="↔"
            ariaLabel="Fit page"
            title="Fit page"
            onClick={onFitPage}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button toolbar-icon-button-wide"
            label="100%"
            icon="1:1"
            ariaLabel="Reset zoom to 100%"
            title="Reset zoom to 100%"
            onClick={onResetZoom}
          />
        </div>

        <ToolbarSectionBreak label="Save" />

        <div className="toolbar-button-cluster toolbar-button-cluster-actions" aria-label="Draft actions">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Discard"
            icon="×"
            ariaLabel="Discard draft changes"
            title="Discard draft changes"
            disabled={!canDiscard}
            onClick={onDiscard}
          />
          <ToolbarButton
            className="primary-button toolbar-icon-button"
            label="Save"
            icon="✓"
            ariaLabel="Save draft"
            title="Save draft"
            disabled={!canSave}
            onClick={onSave}
          />
          {reviewLabel ? (
            <ToolbarButton
              className="secondary-button toolbar-icon-button"
              label={reviewShortLabel(reviewLabel)}
              icon={reviewIcon(reviewLabel)}
              ariaLabel={reviewLabel}
              title={reviewLabel}
              disabled={!canReview}
              onClick={onReviewAction}
            />
          ) : null}
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Seg"
            icon="▣"
            ariaLabel="Mark segmented"
            title="Mark segmented"
            disabled={!canMarkSegmented}
            onClick={onMarkSegmented}
          />
        </div>
      </div>

    </section>
  )
}
