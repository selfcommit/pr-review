import { ReactNode, useState } from 'react'
import { RepoStats, StatsPR, StatsSummary, formatLatency } from '../types/stats'
import { useStats } from '../hooks/useStats'
import { useProfileVisibility } from '../hooks/useProfileVisibility'

type StatTone = 'green' | 'amber' | 'red' | 'blue' | 'slate'

function StatCard({
  label,
  value,
  tone,
  sublabel,
  icon,
}: {
  label: string
  value: string | number
  tone?: StatTone
  sublabel?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className={`stat-card stat-card-${tone || 'slate'}`}>
      <div className="stat-card-label">{icon && <span className="stat-card-icon">{icon}</span>}{label}</div>
      <div className="stat-card-value">{value}</div>
      {sublabel && <div className="stat-card-sublabel">{sublabel}</div>}
    </div>
  )
}

const ApprovedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
  </svg>
)

const ChangesRequestedIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2.75 1.5a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM2.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 12.25 16H2.75A1.75 1.75 0 0 1 1 14.25V1.75C1 .784 1.784 0 2.75 0Zm3.726 7.538H5.31a.75.75 0 0 1 0-1.5h1.166a.75.75 0 0 1 0 1.5Zm0 2.963H5.31a.75.75 0 0 1 0-1.5h1.166a.75.75 0 0 1 0 1.5ZM9.524 6.038h1.166a.75.75 0 0 1 0 1.5H9.524a.75.75 0 0 1 0-1.5Zm0 2.963h1.166a.75.75 0 0 1 0 1.5H9.524a.75.75 0 0 1 0-1.5Z" />
  </svg>
)

const RunnerIcon = () => <span aria-label="runner">🏃</span>

const ON_TARGET_SECONDS = 24 * 3600

function formatPercent(num: number, denom: number): string {
  if (denom <= 0) return '—'
  return `${Math.round((num / denom) * 100)}%`
}

function p90Tone(latencySeconds: number | null | undefined): StatTone {
  if (latencySeconds == null) return 'slate'
  const hours = latencySeconds / 3600
  if (hours >= 24) return 'red'
  if (hours >= 12) return 'amber'
  return 'green'
}

export function StatRow({
  summary,
  sampleLabel,
  includedPrs,
}: {
  summary: StatsSummary
  sampleLabel?: string
  includedPrs: { latency_seconds: number | null }[]
}) {
  const total = summary.total_reviews
  const timedPrs = includedPrs.filter((p): p is { latency_seconds: number } => p.latency_seconds !== null)
  const onTargetCount = timedPrs.filter(p => p.latency_seconds <= ON_TARGET_SECONDS).length
  const hasTimed = timedPrs.length > 0

  const p90Sublabel = hasTimed ? (
    <span className="stat-card-sublabel-accent">
      {formatPercent(onTargetCount, timedPrs.length)} of your reviews took less than 24 hours
    </span>
  ) : null

  return (
    <div className="stats-row">
      <StatCard
        label="Approved"
        value={summary.approved}
        tone="green"
        sublabel={total > 0 ? `${formatPercent(summary.approved, total)} of total` : undefined}
        icon={<ApprovedIcon />}
      />
      <StatCard
        label="Changes Requested"
        value={summary.changes_requested}
        tone="amber"
        sublabel={total > 0 ? `${formatPercent(summary.changes_requested, total)} of total` : undefined}
        icon={<ChangesRequestedIcon />}
      />
      <StatCard
        label="Declined"
        value={summary.declined}
        tone="slate"
        sublabel={<span style={{ display: 'inline' }}>Comment <RunnerIcon /> to decline</span>}
        icon={<RunnerIcon />}
      />
      <StatCard
        label={sampleLabel ? `P90 Review Time (${sampleLabel})` : 'P90 Review Time'}
        value={formatLatency(summary.p90_latency_seconds)}
        tone={p90Tone(summary.p90_latency_seconds)}
        sublabel={p90Sublabel}
      />
    </div>
  )
}

export function PrDrawer({
  prs,
  excludedPrs,
  p90LatencySeconds,
  showRepo,
}: {
  prs: StatsPR[]
  excludedPrs: StatsPR[]
  p90LatencySeconds: number | null
  showRepo?: boolean
}) {
  const [open, setOpen] = useState(false)
  const sorted = excludedPrs.filter(p => p.latency_seconds !== null).slice().sort(
    (a, b) => (b.latency_seconds as number) - (a.latency_seconds as number)
  )
  const hasExcluded = sorted.length > 0
  const timedPrs = prs.filter(p => p.latency_seconds !== null)
  const unrequestedPrs = prs.filter(p => p.latency_seconds === null)
  const totalPrs = timedPrs.length + sorted.length + unrequestedPrs.length

  if (totalPrs === 0) return null

  const rowClass = 'repo-stats-pr-row'
  const excludedRowClass = 'repo-stats-pr-row repo-stats-pr-row--excluded'

  const repoShort = (r?: string) => {
    if (!r) return ''
    const parts = r.split('/')
    return parts[parts.length - 1]
  }

  return (
    <>
      <button
        className="repo-stats-drawer-toggle"
        onClick={() => setOpen(o => !o)}
      >
        {open ? 'Hide' : 'How was this calculated?'}
      </button>

      {open && (
        <div className="repo-stats-pr-list">
          {sorted.map(pr => (
            <a
              key={`excluded-${pr.review_id}`}
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className={excludedRowClass}
            >
              <span className="repo-stats-pr-number">#{pr.pr_number}</span>
              <span className="repo-stats-pr-title">
                {showRepo && <span className="repo-stats-pr-repo-prefix">{repoShort(pr.repo)}</span>}
                {pr.title || '(no title)'}
              </span>
              <span className={`repo-stats-pr-state state-${pr.review_state}`}>
                {pr.review_state === 'approved' ? 'Approved' : 'Changes Req.'}
              </span>
              <span className="repo-stats-pr-latency">{formatLatency(pr.latency_seconds)}</span>
            </a>
          ))}

          {hasExcluded && timedPrs.length > 0 && (
            <div className="repo-stats-pr-cutline" role="separator">
              <span className="repo-stats-pr-cutline-label">
                P90 cutoff · {formatLatency(p90LatencySeconds)}
              </span>
            </div>
          )}

          {timedPrs.map(pr => (
            <a
              key={pr.review_id}
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className={rowClass}
            >
              <span className="repo-stats-pr-number">#{pr.pr_number}</span>
              <span className="repo-stats-pr-title">
                {showRepo && <span className="repo-stats-pr-repo-prefix">{repoShort(pr.repo)}</span>}
                {pr.title || '(no title)'}
              </span>
              <span className={`repo-stats-pr-state state-${pr.review_state}`}>
                {pr.review_state === 'approved' ? 'Approved' : 'Changes Req.'}
              </span>
              <span className="repo-stats-pr-latency">{formatLatency(pr.latency_seconds)}</span>
            </a>
          ))}

          {unrequestedPrs.length > 0 && (
            <>
              {(hasExcluded || timedPrs.length > 0) && (
                <div className="repo-stats-pr-cutline" role="separator">
                  <span className="repo-stats-pr-cutline-label">Unrequested Reviews</span>
                </div>
              )}
              {unrequestedPrs.map(pr => (
                <a
                  key={`unrequested-${pr.review_id}`}
                  href={pr.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={rowClass}
                >
                  <span className="repo-stats-pr-number">#{pr.pr_number}</span>
                  <span className="repo-stats-pr-title">
                    {showRepo && <span className="repo-stats-pr-repo-prefix">{repoShort(pr.repo)}</span>}
                    {pr.title || '(no title)'}
                  </span>
                  <span className={`repo-stats-pr-state state-${pr.review_state}`}>
                    {pr.review_state === 'approved' ? 'Approved' : 'Changes Req.'}
                  </span>
                  <span className="repo-stats-pr-latency repo-stats-pr-latency--unrequested">Unrequested Review</span>
                </a>
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}

function RepoStatsCard({ repo }: { repo: RepoStats }) {
  return (
    <div className="repo-stats-card">
      <div className="repo-stats-header">
        <div className="repo-stats-title">{repo.repo}</div>
        <div className="repo-stats-subtitle">
          {repo.latency_sample_size === 0
            ? 'No completed reviews yet'
            : repo.latency_sample_size < 5
              ? `Limited data (${repo.latency_sample_size} samples)`
              : `${repo.latency_sample_size} samples`}
        </div>
      </div>

      <StatRow
        summary={{
          total_reviews: repo.total_reviews,
          approved: repo.approved,
          changes_requested: repo.changes_requested,
          commented: repo.commented,
          declined: repo.declined,
          p90_latency_seconds: repo.p90_latency_seconds,
          latency_sample_size: repo.latency_sample_size,
        }}
        includedPrs={repo.prs}
      />

      <PrDrawer
        prs={repo.prs}
        excludedPrs={repo.excluded_prs || []}
        p90LatencySeconds={repo.p90_latency_seconds}
      />
    </div>
  )
}

export function ShareProfileCard() {
  const { settings, saving, setHidden } = useProfileVisibility()
  const [copied, setCopied] = useState(false)

  if (!settings) return null

  const profileUrl = `${window.location.origin}/u/${settings.login}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="share-profile-card share-profile-card--prominent">
      <div className="share-profile-card-header">
        <div>
          <h3 className="share-profile-card-title">Share your profile</h3>
          <p className="share-profile-card-subtitle">
            {settings.hidden
              ? 'Your public profile is hidden. Only you can see these stats.'
              : 'Your stats are publicly visible. Share the link with teammates.'}
          </p>
        </div>
        <span
          className={`share-profile-badge ${settings.hidden ? 'share-profile-badge--hidden' : 'share-profile-badge--public'}`}
        >
          {settings.hidden ? 'Hidden' : 'Public'}
        </span>
      </div>

      <div className="share-profile-url-row">
        <input
          type="text"
          readOnly
          value={profileUrl}
          className="share-profile-url"
          onFocus={e => e.currentTarget.select()}
        />
        <button
          type="button"
          onClick={copyLink}
          className="share-profile-copy-btn"
          disabled={settings.hidden}
        >
          {copied ? 'Copied!' : 'Copy link'}
        </button>
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`share-profile-open-btn ${settings.hidden ? 'share-profile-open-btn--disabled' : ''}`}
          aria-disabled={settings.hidden}
          onClick={e => {
            if (settings.hidden) e.preventDefault()
          }}
        >
          Open
        </a>
      </div>

      <label className="share-profile-toggle">
        <input
          type="checkbox"
          checked={settings.hidden}
          onChange={() => setHidden(!settings.hidden)}
          disabled={saving}
        />
        <span>Hide my public profile</span>
      </label>
    </div>
  )
}

function StatsTab() {
  const { data, refreshing, error, refresh } = useStats()

  if (!data && refreshing) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading stats...</p>
      </div>
    )
  }

  if (!data && error) {
    return (
      <div className="error-state">
        <p className="error-message">{error}</p>
        <button onClick={refresh} className="retry-button">Try Again</button>
      </div>
    )
  }

  const windowDays = data?.window_days ?? 120

  if (!data || (data.summary.total_reviews === 0 && data.summary.declined === 0)) {
    return (
      <div className="stats-empty">
        <h2>No review data yet</h2>
        <p>
          Review stats cover the last {windowDays} days of PRs where you reviewed or were
          requested. They populate automatically the first time you open this tab.
        </p>
      </div>
    )
  }

  return (
    <div className="stats-tab">
      <ShareProfileCard />
      <div className="stats-section">
        <div className="stats-section-header">
          <h2 className="stats-section-title">Per Repository</h2>
          <button className="stats-refresh-btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh Stats'}
          </button>
        </div>
        <div className="repo-stats-list">
          {data.repos.map(repo => (
            <RepoStatsCard key={repo.repo} repo={repo} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default StatsTab
