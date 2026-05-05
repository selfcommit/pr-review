import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { StatRow, PrDrawer } from '../components/StatsTab'
import { StatsResponse, RepoStats } from '../types/stats'
import { apiGetPublic } from '../utils/api'
import './DashboardPage.css'
import './PublicProfilePage.css'

interface PublicProfileResponse extends StatsResponse {
  enabled: true
  login: string
  name: string | null
  avatar_url: string | null
}

interface PublicProfileHiddenResponse {
  enabled: false
  login: string
}

type ApiError = Error & { status?: number; payload?: unknown }

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'just now'
  const diffMs = Date.now() - new Date(iso).getTime()
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) {
    const m = Math.round(diffMs / 60_000)
    return `${m} minute${m === 1 ? '' : 's'} ago`
  }
  if (diffMs < 86_400_000) {
    const h = Math.round(diffMs / 3_600_000)
    return `${h} hour${h === 1 ? '' : 's'} ago`
  }
  const d = Math.round(diffMs / 86_400_000)
  return `${d} day${d === 1 ? '' : 's'} ago`
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

function PublicProfilePage() {
  const { login: loginParam } = useParams<{ login: string }>()
  const login = (loginParam || '').trim()
  const [data, setData] = useState<PublicProfileResponse | null>(null)
  const [hidden, setHidden] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!login) {
      document.title = 'PR Review'
      return
    }
    document.title = `@${login} - PR Review Stats`
    let cancelled = false
    setLoading(true)
    setError(null)
    setHidden(false)
    setNotFound(false)
    setData(null)

    apiGetPublic<PublicProfileResponse>(`public-stats/${encodeURIComponent(login)}`)
      .then(resp => {
        if (cancelled) return
        setData(resp)
        document.title = `@${resp.login} - PR Review Stats`
      })
      .catch((err: ApiError) => {
        if (cancelled) return
        if (err.status === 404) {
          const payload = err.payload as PublicProfileHiddenResponse | undefined
          if (payload && payload.enabled === false) {
            setHidden(true)
          } else {
            setNotFound(true)
          }
          return
        }
        setError(err.message || 'Failed to load profile')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [login])

  return (
    <div className="public-profile-page">
      <header className="public-profile-topbar">
        <Link to="/" className="public-profile-brand">PR Review</Link>
        <Link to="/" className="public-profile-signin">Sign in</Link>
      </header>

      <main className="public-profile-main">
        {loading && (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading profile...</p>
          </div>
        )}

        {!loading && notFound && (
          <div className="public-profile-empty">
            <h1>No profile found for @{login}</h1>
            <p>This user has not signed in to PR Review yet.</p>
          </div>
        )}

        {!loading && hidden && (
          <div className="public-profile-empty">
            <h1>@{login}'s profile is private</h1>
            <p>This user has chosen to keep their review stats private.</p>
          </div>
        )}

        {!loading && error && !notFound && !hidden && (
          <div className="error-state">
            <p className="error-message">{error}</p>
          </div>
        )}

        {!loading && data && (
          <PublicProfileContent data={data} />
        )}
      </main>
    </div>
  )
}

function PublicProfileContent({ data }: { data: PublicProfileResponse }) {
  const windowDays = data.window_days ?? 120
  const summary = data.summary
  const prs = summary.prs || []
  const excludedPrs = summary.excluded_prs || []

  const hasAny =
    summary.total_reviews > 0 || summary.declined > 0

  return (
    <>
      <section className="public-profile-header">
        {data.avatar_url && (
          <img
            src={data.avatar_url}
            alt={`${data.login} avatar`}
            className="public-profile-avatar"
          />
        )}
        <div className="public-profile-identity">
          {data.name && <h1 className="public-profile-name">{data.name}</h1>}
          <a
            href={`https://github.com/${data.login}`}
            target="_blank"
            rel="noopener noreferrer"
            className="public-profile-login"
          >
            @{data.login}
          </a>
          {data.backfilled_at && (
            <div className="public-profile-updated">
              Updated {formatRelative(data.backfilled_at)}
            </div>
          )}
        </div>
      </section>

      {!hasAny ? (
        <div className="stats-empty">
          <h2>No review activity yet</h2>
          <p>
            Review stats cover the last {windowDays} days of PRs where this
            user reviewed or was requested.
          </p>
        </div>
      ) : (
        <>
          <div className="overall-stats-bar">
            <div className="stats-section-header">
              <h2 className="stats-section-title">
                All Repositories (last {windowDays} days)
              </h2>
            </div>
            <StatRow
              summary={summary}
              sampleLabel={`${summary.latency_sample_size} samples`}
              includedPrs={prs}
            />
            <PrDrawer
              prs={prs}
              excludedPrs={excludedPrs}
              p90LatencySeconds={summary.p90_latency_seconds}
              showRepo
            />
          </div>

          <div className="stats-tab">
            <div className="stats-section">
              <div className="stats-section-header">
                <h2 className="stats-section-title">Per Repository</h2>
              </div>
              <div className="repo-stats-list">
                {data.repos.map(repo => (
                  <RepoStatsCard key={repo.repo} repo={repo} />
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export default PublicProfilePage
