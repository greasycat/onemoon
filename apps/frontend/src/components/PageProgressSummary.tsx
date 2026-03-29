import type { PageReviewStatus } from '../lib/types'

interface PageProgressSummaryProps {
  counts: Record<PageReviewStatus, number>
}

const pageStatusLabels: Record<PageReviewStatus, string> = {
  unreviewed: 'Open',
  in_review: 'Draft',
  segmented: 'Ready',
}

export function PageProgressSummary({ counts }: PageProgressSummaryProps) {
  return (
    <section className="progress-summary">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Page Status</p>
        </div>
      </div>

      <div className="progress-grid">
        <div className="stat-card">
          <span>{pageStatusLabels.unreviewed}</span>
          <strong>{counts.unreviewed}</strong>
        </div>
        <div className="stat-card">
          <span>{pageStatusLabels.in_review}</span>
          <strong>{counts.in_review}</strong>
        </div>
        <div className="stat-card">
          <span>{pageStatusLabels.segmented}</span>
          <strong>{counts.segmented}</strong>
        </div>
      </div>
    </section>
  )
}
