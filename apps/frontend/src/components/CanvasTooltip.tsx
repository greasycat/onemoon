interface CanvasTooltipProps {
  label: string
  message: string
}

export function CanvasTooltip({ label, message }: CanvasTooltipProps) {
  return (
    <section className="canvas-tooltip" aria-live="polite">
      <span className="canvas-tooltip-primary">{label}</span>
      <span className="canvas-tooltip-secondary muted-text">{message}</span>
    </section>
  )
}
