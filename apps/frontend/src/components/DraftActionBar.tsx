interface DraftActionBarProps {
  blockCount: number
  selectedBlockLabel: string
  reviewStatusLabel: string
  isDirty: boolean
  isLocked: boolean
  saveDisabled: boolean
  discardDisabled: boolean
  reviewDisabled: boolean
  reviewLabel: string | null
  isSaving: boolean
  isBusy: boolean
  onSave: () => void
  onDiscard: () => void
  onReviewAction: () => void
}

export function DraftActionBar({
  blockCount,
  selectedBlockLabel,
  reviewStatusLabel,
  isDirty,
  isLocked,
  saveDisabled,
  discardDisabled,
  reviewDisabled,
  reviewLabel,
  isSaving,
  isBusy,
  onSave,
  onDiscard,
  onReviewAction,
}: DraftActionBarProps) {
  return (
    <section className="panel draft-action-bar">
      <div className="draft-action-meta">
        <div>
          <p className="eyebrow">Draft Actions</p>
          <h2>{isDirty ? 'Unsaved layout changes' : 'Layout synced'}</h2>
        </div>
        <div className="status-stack">
          <span className={`status-chip status-${reviewStatusLabel}`}>{reviewStatusLabel.replace('_', ' ')}</span>
          {isLocked ? <span className="status-chip status-pending">locked</span> : null}
          <span className="status-chip status-review">{blockCount} blocks</span>
        </div>
      </div>

      <div className="draft-action-summary">
        <span>{selectedBlockLabel}</span>
        <span>{isDirty ? 'Save to finish this page.' : 'Ready to save and finish this page.'}</span>
      </div>

      <div className="draft-action-buttons">
        <button type="button" className="primary-button" disabled={saveDisabled} onClick={onSave}>
          {isSaving ? 'Saving...' : 'Save'}
        </button>
        <button type="button" className="secondary-button" disabled={discardDisabled} onClick={onDiscard}>
          Discard Draft
        </button>
        {reviewLabel ? (
          <button type="button" className="secondary-button" disabled={reviewDisabled} onClick={onReviewAction}>
            {isBusy ? `${reviewLabel}...` : reviewLabel}
          </button>
        ) : null}
      </div>
    </section>
  )
}
