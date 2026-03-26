import type { PageReviewStatus } from '../lib/types'

interface PageProgressSummaryProps {
  currentPageIndex: number
  totalPages: number
  counts: Record<PageReviewStatus, number>
  nextUnreviewedPageLabel: string | null
  onJumpToNextUnreviewed: () => void
}

export function PageProgressSummary({
  currentPageIndex,
  totalPages,
  counts,
  nextUnreviewedPageLabel,
  onJumpToNextUnreviewed,
}: PageProgressSummaryProps) {
  return (
    <section className="progress-summary">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review Progress</p>
          <h2>
            Page {currentPageIndex + 1} of {totalPages}
          </h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={!nextUnreviewedPageLabel}
          onClick={onJumpToNextUnreviewed}
        >
          {nextUnreviewedPageLabel ? `Jump to ${nextUnreviewedPageLabel}` : 'All pages reviewed'}
        </button>
      </div>

      <div className="progress-grid">
        <div className="stat-card">
          <span>Unreviewed</span>
          <strong>{counts.unreviewed}</strong>
        </div>
        <div className="stat-card">
          <span>In Review</span>
          <strong>{counts.in_review}</strong>
        </div>
        <div className="stat-card">
          <span>Segmented</span>
          <strong>{counts.segmented}</strong>
        </div>
      </div>
    </section>
  )
}
