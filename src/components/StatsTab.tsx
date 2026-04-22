import { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import { RepoStats, StatsResponse, StatsSummary, formatLatency } from '../types/stats'

type StatTone = 'green' | 'amber' | 'red' | 'blue' | 'slate'

function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: StatTone }) {
  return (
    <div className={`stat-card stat-card-${tone || 'slate'}`}>
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  )
}

function p90Tone(latencySeconds: number | null | undefined): StatTone {
  if (latencySeconds == null) return 'slate'
  const hours = latencySeconds / 3600
  if (hours >= 24) return 'red'
  if (hours >= 12) return 'amber'
  return 'green'
}

function StatRow({ summary, sampleLabel }: { summary: StatsSummary; sampleLabel?: string }) {
  return (
    <div className="stats-row">
      <StatCard label="Total Reviews" value={summary.total_reviews} tone="blue" />
      <StatCard label="Approved" value={summary.approved} tone="green" />
      <StatCard label="Changes Requested" value={summary.changes_requested} tone="amber" />
      <StatCard
        label={sampleLabel ? `P90 Review Time (${sampleLabel})` : 'P90 Review Time'}
        value={formatLatency(summary.p90_latency_seconds)}
        tone={p90Tone(summary.p90_latency_seconds)}
      />
    </div>
  )
}

function RepoStatsCard({ repo }: { repo: RepoStats }) {
  const [open, setOpen] = useState(false)
  const hasLatency = repo.latency_sample_size > 0

  return (
    <div className="repo-stats-card">
      <div className="repo-stats-header">
        <div className="repo-stats-title">{repo.repo}</div>
        <div className="repo-stats-subtitle">
          {repo.latency_sample_size === 0
            ? 'No completed reviews with latency yet'
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
          p90_latency_seconds: repo.p90_latency_seconds,
          latency_sample_size: repo.latency_sample_size,
        }}
      />

      {hasLatency && (
        <button
          className="repo-stats-drawer-toggle"
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'Hide PRs used in P90' : `View ${repo.prs.length} PR${repo.prs.length === 1 ? '' : 's'} used in P90`}
        </button>
      )}

      {open && hasLatency && (
        <div className="repo-stats-pr-list">
          {repo.prs.map(pr => (
            <a
              key={pr.pr_id}
              href={pr.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="repo-stats-pr-row"
            >
              <span className="repo-stats-pr-number">#{pr.pr_number}</span>
              <span className="repo-stats-pr-title">{pr.title || '(no title)'}</span>
              <span className={`repo-stats-pr-state state-${pr.review_state}`}>
                {pr.review_state === 'approved' ? 'Approved' : 'Changes Req.'}
              </span>
              <span className="repo-stats-pr-latency">{formatLatency(pr.latency_seconds)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

function StatsTab() {
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const resp = await apiGet<StatsResponse>('stats')
      setData(resp)
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading stats...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-message">{error}</p>
        <button onClick={load} className="retry-button">Try Again</button>
      </div>
    )
  }

  if (!data || data.summary.total_reviews === 0) {
    return (
      <div className="stats-empty">
        <h2>No review data yet</h2>
        <p>
          Review stats populate automatically as you use the dashboard. Load the Pull Requests tab
          at least once after completing reviews on GitHub, then come back here.
        </p>
      </div>
    )
  }

  return (
    <div className="stats-tab">
      <div className="stats-section">
        <div className="stats-section-header">
          <h2 className="stats-section-title">All Repositories</h2>
          <button className="stats-refresh-btn" onClick={load}>
            Refresh
          </button>
        </div>
        <StatRow
          summary={data.summary}
          sampleLabel={`${data.summary.latency_sample_size} samples`}
        />
      </div>

      <div className="stats-section">
        <h2 className="stats-section-title">Per Repository</h2>
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
