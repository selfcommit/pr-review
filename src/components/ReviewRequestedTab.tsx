import { useState } from 'react'
import type { PullRequest } from '../types/pullRequest'
import { groupByOrg, mapItem } from '../types/pullRequest'
import { isOverdue } from '../utils/time'
import PRCard from './PRCard'

interface UrgencyGroup {
  label: string
  prs: PullRequest[]
}

function groupByUrgency(prs: PullRequest[]): UrgencyGroup[] {
  const overdue: PullRequest[] = []
  const recent: PullRequest[] = []

  for (const pr of prs) {
    if (pr.review_requested_at && isOverdue(pr.review_requested_at)) {
      overdue.push(pr)
    } else {
      recent.push(pr)
    }
  }

  overdue.sort((a, b) => {
    const aTime = a.review_requested_at ? new Date(a.review_requested_at).getTime() : Infinity
    const bTime = b.review_requested_at ? new Date(b.review_requested_at).getTime() : Infinity
    return aTime - bTime
  })

  recent.sort((a, b) => {
    const aTime = a.review_requested_at ? new Date(a.review_requested_at).getTime() : Infinity
    const bTime = b.review_requested_at ? new Date(b.review_requested_at).getTime() : Infinity
    return aTime - bTime
  })

  const groups: UrgencyGroup[] = []
  if (overdue.length > 0) groups.push({ label: 'overdue', prs: overdue })
  if (recent.length > 0) groups.push({ label: 'recent', prs: recent })
  return groups
}

interface ReviewRequestedTabProps {
  reviewRequestedItems: Array<Record<string, unknown>>
  reviewedItems: Array<Record<string, unknown>>
  reviewTimestamps: Record<number, string>
}

function ReviewRequestedTab({ reviewRequestedItems, reviewedItems, reviewTimestamps }: ReviewRequestedTabProps) {
  const [showDrafts, setShowDrafts] = useState(false)

  const allReviewPRs = reviewRequestedItems.map(item => {
    const pr = mapItem(item)
    const ts = reviewTimestamps[pr.id]
    if (ts) pr.review_requested_at = ts
    return pr
  })

  const reviewPRs = showDrafts ? allReviewPRs : allReviewPRs.filter(pr => !pr.draft)

  const urgencyGroups = groupByUrgency(reviewPRs)
  const overdueCount = urgencyGroups.find(g => g.label === 'overdue')?.prs.length || 0

  const reviewRequestedIds = new Set(reviewRequestedItems.map(it => it.id as number))
  const filteredReviewed = reviewedItems.filter(
    item => !reviewRequestedIds.has(item.id as number)
  )
  const reviewedPRs = filteredReviewed.map(mapItem)
  const reviewedByOrg = groupByOrg(reviewedPRs)

  return (
    <>
      <div className="drafts-toggle-bar">
        <label className="drafts-toggle">
          <span className="drafts-toggle-label">Show Drafts</span>
          <button
            type="button"
            role="switch"
            aria-checked={showDrafts}
            className={`toggle-switch ${showDrafts ? 'toggle-switch-on' : ''}`}
            onClick={() => setShowDrafts(prev => !prev)}
          >
            <span className="toggle-knob" />
          </button>
        </label>
      </div>

      {reviewPRs.length === 0 ? (
        <div className="empty-state">
          <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
          </svg>
          <h2>No pending reviews</h2>
          <p>You're all caught up! No pull requests are waiting for your review.</p>
        </div>
      ) : (
        <div className="urgency-container">
          {urgencyGroups.map(group => (
            <div
              key={group.label}
              className={`urgency-section ${group.label === 'overdue' ? 'urgency-section-overdue' : 'urgency-section-recent'}`}
            >
              <div className="urgency-header">
                {group.label === 'overdue' ? (
                  <>
                    <div className="urgency-header-left">
                      <svg className="urgency-icon urgency-icon-overdue" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
                        <path d="M4.72.22a.75.75 0 0 1 1.06 0l1 1a.75.75 0 0 1-1.06 1.06l-1-1a.75.75 0 0 1 0-1.06Zm6.56 0a.75.75 0 0 1 0 1.06l-1 1a.75.75 0 1 1-1.06-1.06l1-1a.75.75 0 0 1 1.06 0ZM8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0ZM8 5.75a.75.75 0 0 1 .75.75v1.69l.72.72a.75.75 0 1 1-1.06 1.06l-1-1A.75.75 0 0 1 7.25 8V6.5a.75.75 0 0 1 .75-.75Z"/>
                      </svg>
                      <h2 className="urgency-title urgency-title-overdue">Waiting 24+ hours</h2>
                    </div>
                    <span className="urgency-count urgency-count-overdue">{overdueCount}</span>
                  </>
                ) : (
                  <>
                    <div className="urgency-header-left">
                      <svg className="urgency-icon urgency-icon-recent" viewBox="0 0 16 16" fill="currentColor" width="18" height="18">
                        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
                      </svg>
                      <h2 className="urgency-title urgency-title-recent">Recent requests</h2>
                    </div>
                    <span className="urgency-count urgency-count-recent">{group.prs.length}</span>
                  </>
                )}
              </div>
              <div className="prs-list">
                {group.prs.map(pr => (
                  <PRCard key={pr.id} pr={pr} showState={false} showWaitTime />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-block section-reviewed">
        <h2 className="section-title section-title-teal">Recently Reviewed</h2>
        {reviewedByOrg.length === 0 ? (
          <p className="section-empty-message">No recently reviewed PRs found.</p>
        ) : (
          <div className="orgs-container">
            {reviewedByOrg.map(orgData => (
              <div key={orgData.org} className="org-section">
                <div className="org-header">
                  <h2 className="org-name">{orgData.org}</h2>
                  <span className="org-count">{orgData.pullRequests.length} PR{orgData.pullRequests.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="prs-list">
                  {orgData.pullRequests.map(pr => (
                    <PRCard key={pr.id} pr={pr} showState />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}

export default ReviewRequestedTab
