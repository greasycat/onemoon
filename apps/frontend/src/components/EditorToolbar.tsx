type ActiveTool = 'select' | 'create'
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

        <div className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-button-cluster" aria-label="Tool selection">
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'select' ? 'pill-button-active' : ''}`}
            label="Pick"
            icon="◎"
            ariaLabel="Select tool"
            title="Select tool"
            onClick={() => onSetTool('select')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'create' ? 'pill-button-active' : ''}`}
            label="Rect"
            icon="✎"
            ariaLabel="Draw block"
            title="Draw block"
            disabled={activePageLocked}
            onClick={() => onSetTool('create')}
          />
        </div>

        <div className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-button-cluster" aria-label="Zoom controls">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Zoom"
            icon="−"
            ariaLabel="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Zoom"
            icon="+"
            ariaLabel="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="PAGE W"
            icon="↔"
            ariaLabel="Fit page"
            title="Fit page"
            onClick={onFitPage}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button toolbar-icon-button-wide"
            label="Reset"
            icon="1:1"
            ariaLabel="Reset zoom to 100%"
            title="Reset zoom to 100%"
            onClick={onResetZoom}
          />
        </div>

        <div className="toolbar-divider" aria-hidden="true" />

        <div className="toolbar-button-cluster toolbar-button-cluster-actions" aria-label="Draft actions">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="ALL"
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
