import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './DashboardPage.css'

interface PullRequest {
  id: number
  title: string
  html_url: string
  created_at: string
  updated_at: string
  state: string
  pull_request_merged: boolean
  repository: {
    name: string
    full_name: string
    html_url: string
  }
  user: {
    login: string
    avatar_url: string
  }
  draft: boolean
}

interface OrgPRs {
  org: string
  pullRequests: PullRequest[]
}

interface GitHubUser {
  login: string
  name: string
  avatar_url: string
}

interface QueryDebugInfo {
  query: string
  status: number
  totalCount: number | null
  itemsReturned: number | null
  message: string | null
  rateLimitRemaining: string | null
  rateLimitReset: string | null
}

interface DebugInfo {
  timestamp: string
  username: string | null
  tokenPreview: string | null
  queries: QueryDebugInfo[]
}

function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [orgPRs, setOrgPRs] = useState<OrgPRs[]>([])
  const [recentlyReviewedPRs, setRecentlyReviewedPRs] = useState<OrgPRs[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)

  useEffect(() => {
    const userJson = localStorage.getItem('github_user')
    if (userJson) {
      setUser(JSON.parse(userJson))
    }
    fetchPullRequests()
  }, [])

  const fetchPullRequests = async () => {
    try {
      setLoading(true)
      setError(null)
      const token = localStorage.getItem('github_access_token')
      const userJson = localStorage.getItem('github_user')
      const username = userJson ? JSON.parse(userJson).login : null

      if (!token) {
        navigate('/')
        return
      }

      const tokenPreview = token.length > 8
        ? `${token.slice(0, 4)}..${token.slice(-4)}`
        : '(short token)'

      const pendingQueries = [
        'is:open is:pr review-requested:@me',
        'is:open is:pr assignee:@me',
      ]
      const reviewedQuery = 'is:pr reviewed-by:@me sort:updated-desc'
      const allQueries = [...pendingQueries, reviewedQuery]

      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      }

      const responses = await Promise.all(
        allQueries.map(q =>
          fetch(
            `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=${q === reviewedQuery ? '30' : '100'}`,
            { headers }
          )
        )
      )

      const queryDebugInfos: QueryDebugInfo[] = responses.map((resp, i) => ({
        query: allQueries[i],
        status: resp.status,
        totalCount: null,
        itemsReturned: null,
        message: null,
        rateLimitRemaining: resp.headers.get('X-RateLimit-Remaining'),
        rateLimitReset: resp.headers.get('X-RateLimit-Reset'),
      }))

      for (const resp of responses) {
        if (resp.status === 401) {
          localStorage.removeItem('github_access_token')
          localStorage.removeItem('github_user')
          navigate('/')
          return
        }
      }

      const results = await Promise.all(responses.map(r => r.json()))

      results.forEach((data, i) => {
        queryDebugInfos[i].totalCount = data.total_count ?? null
        queryDebugInfos[i].itemsReturned = data.items ? data.items.length : null
        queryDebugInfos[i].message = data.message || null
      })

      setDebugInfo({
        timestamp: new Date().toISOString(),
        username,
        tokenPreview,
        queries: queryDebugInfos,
      })

      for (const data of results) {
        if (data.message && !data.items) {
          throw new Error(data.message)
        }
      }

      const pendingResults = results.slice(0, 2)
      const seen = new Set<number>()
      const pendingItems: any[] = []
      for (const data of pendingResults) {
        if (!data.items) continue
        for (const item of data.items) {
          if (!seen.has(item.id)) {
            seen.add(item.id)
            pendingItems.push(item)
          }
        }
      }

      const mapItem = (item: any): PullRequest => ({
        id: item.id,
        title: item.title,
        html_url: item.html_url,
        created_at: item.created_at,
        updated_at: item.updated_at,
        state: item.state,
        pull_request_merged: item.pull_request?.merged_at != null,
        repository: {
          name: item.repository_url.split('/').pop(),
          full_name: item.repository_url.split('/').slice(-2).join('/'),
          html_url: item.html_url.split('/pull/')[0],
        },
        user: {
          login: item.user.login,
          avatar_url: item.user.avatar_url,
        },
        draft: item.draft || false,
      })

      const groupByOrg = (prs: PullRequest[]): OrgPRs[] => {
        const grouped = prs.reduce((acc, pr) => {
          const org = pr.repository.full_name.split('/')[0]
          const existing = acc.find(g => g.org === org)
          if (existing) {
            existing.pullRequests.push(pr)
          } else {
            acc.push({ org, pullRequests: [pr] })
          }
          return acc
        }, [] as OrgPRs[])
        grouped.sort((a, b) => a.org.localeCompare(b.org))
        grouped.forEach(g => {
          g.pullRequests.sort((a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          )
        })
        return grouped
      }

      const pendingPRs = pendingItems.map(mapItem)
      setOrgPRs(groupByOrg(pendingPRs))

      const reviewedData = results[2]
      if (reviewedData.items) {
        const pendingIds = new Set(pendingItems.map((it: any) => it.id))
        const reviewedItems = reviewedData.items.filter(
          (item: any) => !pendingIds.has(item.id)
        )
        const reviewedPRs = reviewedItems.map(mapItem)
        setRecentlyReviewedPRs(groupByOrg(reviewedPRs))
      } else {
        setRecentlyReviewedPRs([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pull requests')
      console.error('Error fetching PRs:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = () => {
    localStorage.removeItem('github_access_token')
    localStorage.removeItem('github_user')
    navigate('/')
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
    return date.toLocaleDateString()
  }

  const getPrStateBadge = (pr: PullRequest) => {
    if (pr.pull_request_merged) return { label: 'Merged', className: 'state-badge state-merged' }
    if (pr.state === 'closed') return { label: 'Closed', className: 'state-badge state-closed' }
    return { label: 'Open', className: 'state-badge state-open' }
  }

  const totalPRs = orgPRs.reduce((sum, org) => sum + org.pullRequests.length, 0)
  const totalReviewed = recentlyReviewedPRs.reduce((sum, org) => sum + org.pullRequests.length, 0)

  const renderPRCard = (pr: PullRequest, showState: boolean) => (
    <a
      key={pr.id}
      href={pr.html_url}
      target="_blank"
      rel="noopener noreferrer"
      className="pr-card"
    >
      <div className="pr-header">
        <div className="pr-repo">
          <svg className="repo-icon" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/>
          </svg>
          {pr.repository.name}
        </div>
        <div className="pr-badges">
          {pr.draft && <span className="draft-badge">Draft</span>}
          {showState && (() => {
            const badge = getPrStateBadge(pr)
            return <span className={badge.className}>{badge.label}</span>
          })()}
        </div>
      </div>
      <h3 className="pr-title">{pr.title}</h3>
      <div className="pr-footer">
        <div className="pr-author">
          <img src={pr.user.avatar_url} alt={pr.user.login} className="author-avatar" />
          <span className="author-name">{pr.user.login}</span>
        </div>
        <span className="pr-date">{formatDate(pr.updated_at)}</span>
      </div>
    </a>
  )

  const renderOrgSection = (orgData: OrgPRs, showState: boolean) => (
    <div key={orgData.org} className="org-section">
      <div className="org-header">
        <h2 className="org-name">{orgData.org}</h2>
        <span className="org-count">{orgData.pullRequests.length} PR{orgData.pullRequests.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="prs-list">
        {orgData.pullRequests.map((pr) => renderPRCard(pr, showState))}
      </div>
    </div>
  )

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-left">
            <svg className="header-logo" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <h1 className="header-title">Review Dashboard</h1>
          </div>
          <div className="header-right">
            {user && (
              <div className="user-info">
                <img src={user.avatar_url} alt={user.login} className="user-avatar" />
                <span className="user-name">{user.name || user.login}</span>
              </div>
            )}
            <button onClick={handleSignOut} className="signout-button">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-content">
          <div className="stats-section">
            <div className="stat-card">
              <div className="stat-value">{totalPRs}</div>
              <div className="stat-label">Pending Reviews</div>
            </div>
            <div className="stat-card">
              <div className="stat-value stat-value-teal">{totalReviewed}</div>
              <div className="stat-label">Recently Reviewed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{orgPRs.length}</div>
              <div className="stat-label">Organizations</div>
            </div>
            <button onClick={fetchPullRequests} className="refresh-button" disabled={loading}>
              <svg className="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="loading-state">
              <div className="spinner"></div>
              <p>Loading pull requests...</p>
            </div>
          ) : error ? (
            <div className="error-state">
              <p className="error-message">{error}</p>
              <button onClick={fetchPullRequests} className="retry-button">
                Try Again
              </button>
            </div>
          ) : (
            <>
              {orgPRs.length === 0 ? (
                <div className="empty-state">
                  <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
                  </svg>
                  <h2>No pending reviews</h2>
                  <p>You're all caught up! No pull requests are waiting for your review.</p>
                </div>
              ) : (
                <div className="section-block">
                  <h2 className="section-title">Pending Reviews</h2>
                  <div className="orgs-container">
                    {orgPRs.map((orgData) => renderOrgSection(orgData, false))}
                  </div>
                </div>
              )}

              <div className="section-block section-reviewed">
                <h2 className="section-title section-title-teal">Recently Reviewed</h2>
                {recentlyReviewedPRs.length === 0 ? (
                  <p className="section-empty-message">No recently reviewed PRs found.</p>
                ) : (
                  <div className="orgs-container">
                    {recentlyReviewedPRs.map((orgData) => renderOrgSection(orgData, true))}
                  </div>
                )}
              </div>
            </>
          )}

          {debugInfo && (
            <div className="debug-panel">
              <h3 className="debug-title">API Diagnostics</h3>
              <div className="debug-meta">
                <span>Fetched: {debugInfo.timestamp}</span>
                <span>User: {debugInfo.username || '(unknown)'}</span>
                <span>Token: {debugInfo.tokenPreview || '(none)'}</span>
              </div>
              {debugInfo.queries.map((q, i) => (
                <div key={i} className="debug-query">
                  <div className="debug-query-header">Query {i + 1}</div>
                  <div className="debug-row"><span className="debug-label">Search</span><span className="debug-value">{q.query}</span></div>
                  <div className="debug-row"><span className="debug-label">HTTP Status</span><span className="debug-value">{q.status}</span></div>
                  <div className="debug-row"><span className="debug-label">Total Count</span><span className="debug-value">{q.totalCount ?? 'N/A'}</span></div>
                  <div className="debug-row"><span className="debug-label">Items Returned</span><span className="debug-value">{q.itemsReturned ?? 'N/A'}</span></div>
                  <div className="debug-row"><span className="debug-label">Message</span><span className="debug-value">{q.message || '(none)'}</span></div>
                  <div className="debug-row"><span className="debug-label">Rate Limit Left</span><span className="debug-value">{q.rateLimitRemaining ?? 'N/A'}</span></div>
                  <div className="debug-row"><span className="debug-label">Rate Reset</span><span className="debug-value">{q.rateLimitReset ? new Date(Number(q.rateLimitReset) * 1000).toLocaleTimeString() : 'N/A'}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default DashboardPage
