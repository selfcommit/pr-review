import { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import { mapItem, groupByOrg } from '../types/pullRequest'
import type { OrgPRs } from '../types/pullRequest'
import PRCard from './PRCard'

function AssignedTab() {
  const [orgPRs, setOrgPRs] = useState<OrgPRs[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAssigned = async () => {
    try {
      setLoading(true)
      setError(null)

      const data = await apiGet<{
        assigned: { items?: Array<Record<string, unknown>>; message?: string }
        username: string
      }>('pull-requests-assigned')

      if (data.assigned.message && !data.assigned.items) {
        throw new Error(data.assigned.message)
      }

      const items = data.assigned.items || []
      const prs = items.map(mapItem)
      setOrgPRs(groupByOrg(prs))
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to fetch assigned PRs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAssigned()
  }, [])

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading assigned pull requests...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-message">{error}</p>
        <button onClick={fetchAssigned} className="retry-button">
          Try Again
        </button>
      </div>
    )
  }

  if (orgPRs.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
        </svg>
        <h2>No assigned PRs</h2>
        <p>You don't have any open pull requests assigned to you.</p>
      </div>
    )
  }

  return (
    <div className="orgs-container">
      {orgPRs.map(orgData => (
        <div key={orgData.org} className="org-section">
          <div className="org-header">
            <h2 className="org-name">{orgData.org}</h2>
            <span className="org-count">{orgData.pullRequests.length} PR{orgData.pullRequests.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="prs-list">
            {orgData.pullRequests.map(pr => (
              <PRCard key={pr.id} pr={pr} showState={false} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export default AssignedTab
