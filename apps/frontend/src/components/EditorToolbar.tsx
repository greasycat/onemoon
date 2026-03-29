import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowRight,
  MousePointer2,
  PenTool,
  Ratio,
  Save,
  Scan,
  Scissors,
  Square,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

type ActiveTool = 'select' | 'rect' | 'freeform' | 'cut'
type ViewMode = 'fit-page' | 'fit-width' | 'manual'

interface ToolbarButtonProps {
  className: string
  label: string
  icon: LucideIcon
  ariaLabel: string
  title: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
}

function ToolbarButton({ className, label, icon, ariaLabel, title, shortcut, disabled, onClick }: ToolbarButtonProps) {
  const Icon = icon
  return (
    <button type="button" className={className} aria-label={ariaLabel} title={title} disabled={disabled} onClick={onClick}>
      <span className="toolbar-button-main">
        <span className="toolbar-button-text">{label}</span>
        {shortcut ? <span className="toolbar-button-shortcut">{shortcut}</span> : null}
      </span>
      <span className="toolbar-button-icon" aria-hidden="true">
        <Icon />
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
            icon={ArrowLeft}
            ariaLabel="Previous page"
            title="Previous page"
            disabled={!canGoPrevious}
            onClick={onPreviousPage}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Next"
            icon={ArrowRight}
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
            icon={MousePointer2}
            ariaLabel="Select tool"
            title="Select tool (P)"
            shortcut="P"
            onClick={() => onSetTool('select')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'rect' ? 'pill-button-active' : ''}`}
            label="Rect"
            icon={Square}
            ariaLabel="Draw rectangle block"
            title="Draw rectangle block (R)"
            shortcut="R"
            disabled={activePageLocked}
            onClick={() => onSetTool('rect')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'freeform' ? 'pill-button-active' : ''}`}
            label="Free"
            icon={PenTool}
            ariaLabel="Draw free-form block"
            title="Draw free-form block (F)"
            shortcut="F"
            disabled={activePageLocked}
            onClick={() => onSetTool('freeform')}
          />
          <ToolbarButton
            className={`pill-button toolbar-icon-button ${activeTool === 'cut' ? 'pill-button-active' : ''}`}
            label="Cut"
            icon={Scissors}
            ariaLabel="Draw cut block"
            title="Draw cut block (C)"
            shortcut="C"
            disabled={activePageLocked}
            onClick={() => onSetTool('cut')}
          />
        </div>

        <ToolbarSectionBreak label="Zoom" />

        <div className="toolbar-button-cluster" aria-label="Zoom controls">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Out"
            icon={ZoomOut}
            ariaLabel="Zoom out"
            title="Zoom out"
            onClick={onZoomOut}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="In"
            icon={ZoomIn}
            ariaLabel="Zoom in"
            title="Zoom in"
            onClick={onZoomIn}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Fit"
            icon={Scan}
            ariaLabel="Fit page"
            title="Fit page"
            onClick={onFitPage}
          />
          <ToolbarButton
            className="secondary-button toolbar-icon-button toolbar-icon-button-wide"
            label="100%"
            icon={Ratio}
            ariaLabel="Show the full page at 100%"
            title="Show the full page at 100%"
            onClick={onResetZoom}
          />
        </div>

        <ToolbarSectionBreak label="Save" />

        <div className="toolbar-button-cluster toolbar-button-cluster-actions" aria-label="Draft actions">
          <ToolbarButton
            className="secondary-button toolbar-icon-button"
            label="Discard"
            icon={Trash2}
            ariaLabel="Discard draft changes"
            title="Discard draft changes"
            disabled={!canDiscard}
            onClick={onDiscard}
          />
          <ToolbarButton
            className="primary-button toolbar-icon-button"
            label="Save"
            icon={Save}
            ariaLabel="Save page and finish"
            title="Save page and finish (S or Ctrl/Cmd+S)"
            shortcut="S"
            disabled={!canSave}
            onClick={onSave}
          />
        </div>
      </div>
    </section>
  )
}
