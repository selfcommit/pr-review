import type { PullRequest } from '../types/pullRequest'
import { formatDate, formatWaitTime, getUrgencyLevel } from '../utils/time'

interface PRCardProps {
  pr: PullRequest
  showState: boolean
  showWaitTime?: boolean
}

function getPrStateBadge(pr: PullRequest) {
  if (pr.pull_request_merged) return { label: 'Merged', className: 'state-badge state-merged' }
  if (pr.state === 'closed') return { label: 'Closed', className: 'state-badge state-closed' }
  return { label: 'Open', className: 'state-badge state-open' }
}

function PRCard({ pr, showState, showWaitTime }: PRCardProps) {
  const urgency = pr.review_requested_at ? getUrgencyLevel(pr.review_requested_at) : null

  return (
    <a
      href={pr.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="pr-card"
    >
      <div className="pr-header">
        <div className="pr-repo">
          <img src={pr.user.avatar_url} alt={pr.user.login} className="author-avatar" />
          <svg className="repo-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>
          </svg>
          {pr.repository.name}
          <span className="pr-header-separator">·</span>
          <span className="author-name">{pr.user.login}</span>
          <span className="pr-header-separator">·</span>
          <span className="pr-date">{formatDate(pr.updated_at)}</span>
        </div>
        <div className="pr-badges">
          {pr.draft && <span className="draft-badge">Draft</span>}
          {showState && (() => {
            const badge = getPrStateBadge(pr)
            return <span className={badge.className}>{badge.label}</span>
          })()}
          {showWaitTime && pr.review_requested_at && urgency && (
            <span className={`wait-badge wait-badge-${urgency}`}>
              <svg viewBox="0 0 16 16" fill="currentColor" width="12" height="12">
                <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.751.751 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0Z"/>
              </svg>
              {formatWaitTime(pr.review_requested_at)}
            </span>
          )}
        </div>
      </div>
      <h3 className="pr-title">{pr.title}</h3>
    </a>
  )
}

export default PRCard
