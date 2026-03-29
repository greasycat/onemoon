interface WorkspaceMergedCodePanelProps {
  mergedSource: string
}

export function WorkspaceMergedCodePanel({ mergedSource }: WorkspaceMergedCodePanelProps) {
  return (
    <aside className="workspace-merged-code-panel">
      <section className="workspace-document-preview-section workspace-document-source">
        <p className="eyebrow">Merged code</p>
        <div className="generated-output workspace-merged-code-source">
          <pre>{mergedSource}</pre>
        </div>
      </section>
    </aside>
  )
}
