import { Ratio, Scan, ZoomIn, ZoomOut } from 'lucide-react'

interface ConversionModeToolbarProps {
  zoomPercent: number
  onZoomOut: () => void
  onZoomIn: () => void
  onFitPage: () => void
  onResetZoom: () => void
}

interface ConversionToolbarButtonProps {
  icon: typeof ZoomIn
  label: string
  title: string
  onClick: () => void
}

function ConversionToolbarButton({ icon: Icon, label, title, onClick }: ConversionToolbarButtonProps) {
  return (
    <button
      type="button"
      className="secondary-button conversion-mode-toolbar-button"
      aria-label={label}
      title={title}
      onClick={onClick}
    >
      <Icon aria-hidden="true" />
    </button>
  )
}

export function ConversionModeToolbar({
  zoomPercent,
  onZoomOut,
  onZoomIn,
  onFitPage,
  onResetZoom,
}: ConversionModeToolbarProps) {
  return (
    <section className="conversion-mode-toolbar" aria-label="Conversion mode zoom controls">
      <span className="conversion-mode-toolbar-pill">{zoomPercent}%</span>
      <div className="conversion-mode-toolbar-controls">
        <ConversionToolbarButton icon={ZoomOut} label="Zoom out" title="Zoom out" onClick={onZoomOut} />
        <ConversionToolbarButton icon={ZoomIn} label="Zoom in" title="Zoom in" onClick={onZoomIn} />
        <ConversionToolbarButton icon={Scan} label="Fit page" title="Fit page" onClick={onFitPage} />
        <ConversionToolbarButton icon={Ratio} label="Show the full page at 100%" title="Show the full page at 100%" onClick={onResetZoom} />
      </div>
    </section>
  )
}
