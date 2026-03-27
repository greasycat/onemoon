import type { PageReviewStatus } from '../lib/types'

interface PageProgressSummaryProps {
  counts: Record<PageReviewStatus, number>
}

export function PageProgressSummary({ counts }: PageProgressSummaryProps) {
  return (
    <section className="progress-summary">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Review Progress</p>
        </div>
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
