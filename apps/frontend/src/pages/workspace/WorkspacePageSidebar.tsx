import { PageProgressSummary } from '../../components/PageProgressSummary'
import { withApiRoot } from '../../lib/api'
import type { PageResponse, PageReviewStatus } from '../../lib/types'

interface WorkspacePageEntry extends PageResponse {
  effectiveReviewStatus: PageReviewStatus
  effectiveBlockCount: number
  dirty: boolean
}

interface WorkspacePageSidebarProps {
  pageEntries: WorkspacePageEntry[]
  reviewCounts: Record<PageReviewStatus, number>
  selectedPageId: string
  onSelectPage: (pageId: string) => void
}

export function WorkspacePageSidebar({
  pageEntries,
  reviewCounts,
  selectedPageId,
  onSelectPage,
}: WorkspacePageSidebarProps) {
  return (
    <div className="page-sidebar panel">
      <PageProgressSummary counts={reviewCounts} />
      <div className="page-list">
        {pageEntries.map((page) => (
          <button
            key={page.id}
            type="button"
            className={`page-card ${selectedPageId === page.id ? 'page-card-active' : ''}`}
            onClick={() => onSelectPage(page.id)}
          >
            <img
              src={withApiRoot(page.image_url) ?? undefined}
              alt={`Page ${page.page_index + 1}`}
              loading="lazy"
            />
            <div>
              <div className="page-card-title">
                <strong>Page {page.page_index + 1}</strong>
                {page.dirty ? <span className="status-dot" /> : null}
              </div>
              <p>{page.effectiveBlockCount} blocks</p>
              <span className={`status-chip status-${page.effectiveReviewStatus}`}>{page.effectiveReviewStatus}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
