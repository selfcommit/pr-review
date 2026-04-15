import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useOrgAccess } from '../hooks/useOrgAccess'
import { usePolling } from '../hooks/usePolling'
import { useNotificationPreference } from '../hooks/useNotificationPreference'
import { getCachedUser, setCachedUser, setSessionToken, logout, apiGet, getSessionToken } from '../utils/api'
import { isInIframe } from '../utils/iframe'
import { isOverdue } from '../utils/time'
import { playChime } from '../utils/notificationSound'
import { sendBrowserNotification } from '../utils/browserNotification'
import { mapItem } from '../types/pullRequest'
import OrgAccessBanner from '../components/OrgAccessBanner'
import OrganizationsTab from '../components/OrganizationsTab'
import ReviewRequestedTab from '../components/ReviewRequestedTab'
import AssignedTab from '../components/AssignedTab'
import NotificationToast from '../components/NotificationToast'
import './DashboardPage.css'

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
  queries: QueryDebugInfo[]
  oauthScopes: string | null
}

interface ToastMessage {
  prId: number
  text: string
}

type TabId = 'pull-requests' | 'organizations'
type PRSubTab = 'review-requested' | 'assigned'

function DashboardPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [reviewRequestedItems, setReviewRequestedItems] = useState<Array<Record<string, unknown>>>([])
  const [reviewedItems, setReviewedItems] = useState<Array<Record<string, unknown>>>([])
  const [reviewTimestamps, setReviewTimestamps] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('pull-requests')
  const [prSubTab, setPrSubTab] = useState<PRSubTab>('review-requested')
  const { orgAccess, fetchOrgs } = useOrgAccess()
  const { soundEnabled, setSoundEnabled } = useNotificationPreference()

  const [highlightedPRIds, setHighlightedPRIds] = useState<Set<number>>(new Set())
  const [toastMessages, setToastMessages] = useState<ToastMessage[] | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reviewTimestampsRef = useRef(reviewTimestamps)
  reviewTimestampsRef.current = reviewTimestamps

  const reviewRequestedItemsRef = useRef(reviewRequestedItems)
  reviewRequestedItemsRef.current = reviewRequestedItems

  const soundEnabledRef = useRef(soundEnabled)
  soundEnabledRef.current = soundEnabled

  const scrollToPR = useCallback((prId: number) => {
    const el = document.getElementById(`pr-${prId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [])

  const triggerHighlight = useCallback((prIds: number[]) => {
    if (prIds.length === 0) return
    setHighlightedPRIds(new Set(prIds))

    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedPRIds(new Set())
      highlightTimerRef.current = null
    }, 2500)
  }, [])

  const handlePollChanges = useCallback((result: {
    updatedPRs: Array<Record<string, unknown>>
    removedPRIds: number[]
    newPRs: Array<Record<string, unknown>>
    reviewTimestamps: Record<number, string>
  }) => {
    const notifyPrIds: number[] = []
    const messages: ToastMessage[] = []

    if (result.newPRs.length > 0) {
      for (const raw of result.newPRs) {
        const pr = mapItem(raw)
        notifyPrIds.push(pr.id)
        messages.push({ prId: pr.id, text: `${pr.repository.full_name}: ${pr.title}` })
      }
    }

    const currentTimestamps = reviewTimestampsRef.current
    const currentItems = reviewRequestedItemsRef.current

    for (const item of currentItems) {
      const prId = item.id as number
      const oldTs = currentTimestamps[prId]
      if (!oldTs) continue
      if (isOverdue(oldTs)) continue
      const newTs = result.reviewTimestamps[prId] || oldTs
      if (isOverdue(newTs) && !notifyPrIds.includes(prId)) {
        const pr = mapItem(item)
        notifyPrIds.push(prId)
        messages.push({ prId, text: `${pr.repository.full_name}: ${pr.title} (now 24h+)` })
      }
    }

    if (result.newPRs.length > 0) {
      setReviewRequestedItems(prev => [...result.newPRs, ...prev])
    }

    if (result.updatedPRs.length > 0) {
      const updatedMap = new Map(result.updatedPRs.map(pr => [pr.id as number, pr]))
      setReviewRequestedItems(prev =>
        prev.map(item => updatedMap.get(item.id as number) || item)
      )
    }

    if (result.removedPRIds.length > 0) {
      const removedSet = new Set(result.removedPRIds)
      setReviewRequestedItems(prev =>
        prev.filter(item => !removedSet.has(item.id as number))
      )
    }

    if (Object.keys(result.reviewTimestamps).length > 0) {
      setReviewTimestamps(prev => ({ ...prev, ...result.reviewTimestamps }))
    }

    if (notifyPrIds.length > 0) {
      if (soundEnabledRef.current) {
        playChime()
        const title = messages.length === 1
          ? 'New review request'
          : `${messages.length} review requests need attention`
        const body = messages[0].text + (messages.length > 1 ? ` +${messages.length - 1} more` : '')
        const firstPrId = notifyPrIds[0]
        sendBrowserNotification(title, body, () => {
          triggerHighlight([firstPrId])
          scrollToPR(firstPrId)
        })
      }
      triggerHighlight(notifyPrIds)
      setToastMessages(messages)
      setTimeout(() => scrollToPR(notifyPrIds[0]), 100)
    }
  }, [triggerHighlight, scrollToPR])

  const pollingEnabled = !loading && !error && activeTab === 'pull-requests' && prSubTab === 'review-requested' && !!getSessionToken()

  const { pause: pausePolling, resume: resumePolling } = usePolling({
    enabled: pollingEnabled,
    intervalMs: 30000,
    onChanges: handlePollChanges,
  })

  const handleOAuthMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== window.location.origin) return
    if (event.data?.type !== 'github-oauth-callback') return

    const { session_token, user: userParam, state } = event.data
    const savedState = sessionStorage.getItem('github_oauth_state')

    if (session_token && state && state === savedState && userParam) {
      setSessionToken(session_token)
      const parsed = JSON.parse(userParam)
      setCachedUser(parsed)
      sessionStorage.removeItem('github_oauth_state')
      setUser(parsed)
      fetchPullRequests()
      fetchOrgs()
    }
  }, [fetchOrgs])

  useEffect(() => {
    const cached = getCachedUser()
    if (cached) {
      setUser(cached)
    }
    fetchPullRequests()
    fetchOrgs()
  }, [fetchOrgs])

  useEffect(() => {
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [handleOAuthMessage])

  const fetchPullRequests = async () => {
    try {
      pausePolling()
      setLoading(true)
      setError(null)

      if (!getSessionToken()) {
        navigate('/')
        return
      }

      const data = await apiGet<{
        reviewRequested?: { items?: Array<Record<string, unknown>>; total_count?: number; message?: string } | null
        reviewed?: { items?: Array<Record<string, unknown>>; total_count?: number; message?: string } | null
        reviewTimestamps?: Record<number, string> | null
        username: string
        rateLimitRemaining: string | null
        rateLimitReset: string | null
        oauthScopes: string | null
      }>('pull-requests')

      const emptyResult: { items?: Array<Record<string, unknown>>; total_count?: number; message?: string } = { items: [], total_count: 0 }
      const reviewRequested = data.reviewRequested || emptyResult
      const reviewed = data.reviewed || emptyResult

      const queries = [
        { query: 'is:open is:pr user-review-requested:@me', result: reviewRequested },
        { query: 'is:pr reviewed-by:@me sort:updated-desc', result: reviewed },
      ]

      const queryDebugInfos: QueryDebugInfo[] = queries.map((q, i) => ({
        query: q.query,
        status: q.result.message ? 422 : 200,
        totalCount: q.result.total_count ?? null,
        itemsReturned: q.result.items ? q.result.items.length : null,
        message: (q.result.message as string) || null,
        rateLimitRemaining: i === 0 ? data.rateLimitRemaining : null,
        rateLimitReset: i === 0 ? data.rateLimitReset : null,
      }))

      setDebugInfo({
        timestamp: new Date().toISOString(),
        username: data.username,
        queries: queryDebugInfos,
        oauthScopes: data.oauthScopes,
      })

      for (const q of queries) {
        if (q.result.message && !q.result.items) {
          throw new Error(q.result.message as string)
        }
      }

      setReviewRequestedItems(Array.isArray(reviewRequested.items) ? reviewRequested.items : [])
      setReviewedItems(Array.isArray(reviewed.items) ? reviewed.items : [])
      setReviewTimestamps(data.reviewTimestamps || {})
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') {
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to fetch pull requests')
    } finally {
      setLoading(false)
      resumePolling()
    }
  }

  const handleSignOut = async () => {
    await logout()
    navigate('/')
  }

  const handleManageOrgAccess = async () => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    const origin = window.location.origin
    const callbackPath = isInIframe() ? '/auth/callback' : ''
    const redirectTo = encodeURIComponent(origin + callbackPath)
    const loginUrl = `${supabaseUrl}/functions/v1/github-auth/login?redirect_to=${redirectTo}`

    try {
      const response = await fetch(loginUrl)
      const data = await response.json()

      if (data.url) {
        sessionStorage.setItem('github_oauth_state', data.state)

        if (isInIframe()) {
          window.open(data.url, 'github-oauth', 'width=600,height=700,menubar=no,toolbar=no')
        } else {
          window.location.href = data.url
        }
      }
    } catch {
      // silently fail -- user can retry
    }
  }

  const handleToastClickPR = useCallback((prId: number) => {
    triggerHighlight([prId])
    scrollToPR(prId)
  }, [triggerHighlight, scrollToPR])

  const handleToastDismiss = useCallback(() => {
    setToastMessages(null)
  }, [])

  const totalReviewRequested = reviewRequestedItems.length
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

      {toastMessages && toastMessages.length > 0 && (
        <NotificationToast
          messages={toastMessages}
          onDismiss={handleToastDismiss}
          onClickPR={handleToastClickPR}
        />
      )}

      <main className="dashboard-main">
        <div className="dashboard-content">
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
            </button>
          </div>

          {activeTab === 'pull-requests' && (
            <>
              <div className="sub-tab-bar">
                <button
                  className={`sub-tab-button ${prSubTab === 'review-requested' ? 'sub-tab-button-active' : ''}`}
                  onClick={() => setPrSubTab('review-requested')}
                >
                  Review Requested
                  {totalReviewRequested > 0 && (
                    <span className="sub-tab-count">{totalReviewRequested}</span>
                  )}
                </button>
                <button
                  className={`sub-tab-button ${prSubTab === 'assigned' ? 'sub-tab-button-active' : ''}`}
                  onClick={() => setPrSubTab('assigned')}
                >
                  Assigned to Me
                </button>
              </div>

              {prSubTab === 'review-requested' && (
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
                    <ReviewRequestedTab
                      reviewRequestedItems={reviewRequestedItems}
                      reviewedItems={reviewedItems}
                      reviewTimestamps={reviewTimestamps}
                      soundEnabled={soundEnabled}
                      onSoundToggle={setSoundEnabled}
                      highlightedPRIds={highlightedPRIds}
                    />
                  )}
                </>
              )}

              {prSubTab === 'assigned' && <AssignedTab />}
            </>
          )}

          {activeTab === 'organizations' && (
            <OrganizationsTab
              orgAccess={orgAccess}
              onManageAccess={handleManageOrgAccess}
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
                    <span>OAuth Scopes: {debugInfo.oauthScopes || '(none)'}</span>
                    <span>Stored Scopes: {orgAccess.oauthScopes || '(none)'}</span>
                  </div>

                  {orgAccess.memberOrgs.length > 0 && (
                    <div className="debug-query">
                      <div className="debug-query-header">Organizations</div>
                      {orgAccess.memberOrgs.map(org => (
                        <div key={org.login} className="debug-row">
                          <span className="debug-label">{org.login}</span>
                          <span className="debug-value debug-status-ok">
                            Member
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
