import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrgAccess } from '../hooks/useOrgAccess'
import { isInIframe } from '../utils/iframe'
import OrgAccessBanner from '../components/OrgAccessBanner'
import OrganizationsTab from '../components/OrganizationsTab'
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

type TabId = 'pull-requests' | 'organizations'

function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [orgPRs, setOrgPRs] = useState<OrgPRs[]>([])
  const [recentlyReviewedPRs, setRecentlyReviewedPRs] = useState<OrgPRs[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [reauthorizeError, setReauthorizeError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('pull-requests')
  const { orgAccess, checkOrgAccess } = useOrgAccess()

  const handleOAuthMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'github-oauth-callback') return

    const { access_token, user: userParam, state } = event.data
    const savedState = sessionStorage.getItem('github_oauth_state')

    if (access_token && state && state === savedState && userParam) {
      localStorage.setItem('github_access_token', access_token)
      localStorage.setItem('github_user', userParam)
      sessionStorage.removeItem('github_oauth_state')
      setUser(JSON.parse(userParam))
      setReauthorizing(false)
      fetchPullRequests()
    } else {
      setReauthorizing(false)
    }
  }, [])

  useEffect(() => {
    const userJson = localStorage.getItem('github_user')
    if (userJson) {
      setUser(JSON.parse(userJson))
    }
    fetchPullRequests()
  }, [])

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [handleOAuthMessage])

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

      const allVisibleOrgs = new Set<string>()
      pendingPRs.forEach(pr => allVisibleOrgs.add(pr.repository.full_name.split('/')[0]))
      if (reviewedData.items) {
        reviewedData.items.forEach((item: any) => {
          const orgName = item.repository_url.split('/').slice(-2)[0]
          allVisibleOrgs.add(orgName)
        })
      }
      checkOrgAccess(Array.from(allVisibleOrgs))
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
    localStorage.removeItem('github_client_id')
    navigate('/')
  }

  const initiateOAuthFlow = async () => {
    setReauthorizing(true)
    setReauthorizeError(null)
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const origin = window.location.origin
      const callbackPath = isInIframe() ? '/auth/callback' : ''
      const redirectTo = encodeURIComponent(origin + callbackPath)
      const loginUrl = `${supabaseUrl}/functions/v1/github-auth/login?redirect_to=${redirectTo}`

      const response = await fetch(loginUrl)
      const data = await response.json()

      if (data.url) {
        sessionStorage.setItem('github_oauth_state', data.state)
        if (data.client_id) localStorage.setItem('github_client_id', data.client_id)
        if (isInIframe()) {
          const popup = window.open(data.url, 'github-oauth', 'width=600,height=700,menubar=no,toolbar=no')
          if (!popup) {
            setReauthorizeError('Pop-up was blocked by your browser. Please allow pop-ups for this site and try again.')
            setReauthorizing(false)
          }
        } else {
          window.location.href = data.url
        }
      } else {
        const message = data.message || data.error || 'Failed to initiate re-authorization. Please try again.'
        setReauthorizeError(message)
        setReauthorizing(false)
      }
    } catch (err) {
      setReauthorizeError(
        err instanceof Error && err.message
          ? `Could not reach the authentication service: ${err.message}`
          : 'Could not reach the authentication service. Check your connection and try again.'
      )
      setReauthorizing(false)
    }
  }

  const handleReauthorize = () => {
    initiateOAuthFlow()
  }

  const handleRevokeAndReconnect = () => {
    localStorage.removeItem('github_access_token')
    localStorage.removeItem('github_user')
    localStorage.removeItem('github_client_id')
    initiateOAuthFlow()
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
  const restrictedCount = orgAccess.restrictedOrgs.length

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
              <div className="stat-value">{orgAccess.memberOrgs.length}</div>
              <div className="stat-label">Organizations</div>
            </div>
            <button onClick={fetchPullRequests} className="refresh-button" disabled={loading}>
              <svg className="refresh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              Refresh
            </button>
          </div>

          <div className="tab-bar">
            <button
              className={`tab-button ${activeTab === 'pull-requests' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveTab('pull-requests')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/>
              </svg>
              Pull Requests
            </button>
            <button
              className={`tab-button ${activeTab === 'organizations' ? 'tab-button-active' : ''}`}
              onClick={() => setActiveTab('organizations')}
            >
              <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                <path d="M1.75 16A1.75 1.75 0 0 1 0 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 0 0 .25-.25V8.285a.25.25 0 0 0-.111-.208l-1.055-.703a.749.749 0 1 1 .832-1.248l1.055.703c.487.325.777.871.777 1.456v5.965A1.75 1.75 0 0 1 14.25 16h-3.5a.766.766 0 0 1-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 0 1-.75-.75V14h-1v1.25a.75.75 0 0 1-.75.75Zm-.25-1.75c0 .138.112.25.25.25H4v-1.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.25h2.25a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25ZM3.75 6h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5ZM3 3.75A.75.75 0 0 1 3.75 3h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 3 3.75Zm4 3A.75.75 0 0 1 7.75 6h.5a.75.75 0 0 1 0 1.5h-.5A.75.75 0 0 1 7 6.75ZM7.75 3h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1 0-1.5Z"/>
              </svg>
              Organizations
              {restrictedCount > 0 && (
                <span className="tab-badge">{restrictedCount}</span>
              )}
            </button>
          </div>

          {activeTab === 'pull-requests' && (
            <>
              {!loading && !error && (
                <OrgAccessBanner
                  orgAccess={orgAccess}
                  onSwitchToOrgsTab={() => setActiveTab('organizations')}
                />
              )}

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
            </>
          )}

          {activeTab === 'organizations' && (
            <OrganizationsTab
              orgAccess={orgAccess}
              onReauthorize={handleReauthorize}
              onRevokeAndReconnect={handleRevokeAndReconnect}
              reauthorizing={reauthorizing}
              reauthorizeError={reauthorizeError}
            />
          )}

          {debugInfo && (
            <div className="debug-panel">
              <button
                className="debug-toggle"
                onClick={() => setDebugOpen(prev => !prev)}
              >
                <h3 className="debug-title">API Diagnostics</h3>
                <svg
                  className={`debug-chevron ${debugOpen ? 'debug-chevron-open' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  width="16"
                  height="16"
                >
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </button>
              {debugOpen && (
                <>
                  <div className="debug-meta">
                    <span>Fetched: {debugInfo.timestamp}</span>
                    <span>User: {debugInfo.username || '(unknown)'}</span>
                    <span>Token: {debugInfo.tokenPreview || '(none)'}</span>
                    {orgAccess.oauthScopes && (
                      <span>Scopes: {orgAccess.oauthScopes}</span>
                    )}
                  </div>

                  {orgAccess.memberOrgs.length > 0 && (
                    <div className="debug-query">
                      <div className="debug-query-header">Organization Access</div>
                      {orgAccess.memberOrgs.map(org => (
                        <div key={org.login} className="debug-row">
                          <span className="debug-label">{org.login}</span>
                          <span className={`debug-value ${org.accessible ? 'debug-status-ok' : 'debug-status-restricted'}`}>
                            {org.accessible ? 'Accessible' : 'Restricted'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

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
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default DashboardPage
