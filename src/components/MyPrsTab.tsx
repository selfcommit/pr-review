import { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import { mapItem, groupByOrg } from '../types/pullRequest'
import type { OrgPRs, PullRequest } from '../types/pullRequest'
import PRCard from './PRCard'

type CategoryKey = 'ready' | 'changes' | 'in_progress'

interface Category {
  key: CategoryKey
  label: string
  className: string
  orgPRs: OrgPRs[]
  count: number
}

function categorize(pr: PullRequest): CategoryKey {
  if (pr.review_decision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.review_decision === 'APPROVED' && !pr.draft) return 'ready'
  return 'in_progress'
}

function buildCategories(prs: PullRequest[]): Category[] {
  const buckets: Record<CategoryKey, PullRequest[]> = {
    ready: [],
    changes: [],
    in_progress: [],
  }

  for (const pr of prs) {
    buckets[categorize(pr)].push(pr)
  }

  const definitions: Array<Omit<Category, 'orgPRs' | 'count'>> = [
    { key: 'ready', label: 'Ready to merge', className: 'mine-section-ready' },
    { key: 'changes', label: 'Changes requested', className: 'mine-section-changes' },
    { key: 'in_progress', label: 'In progress', className: 'mine-section-progress' },
  ]

  return definitions
    .map((def) => ({
      ...def,
      orgPRs: groupByOrg(buckets[def.key]),
      count: buckets[def.key].length,
    }))
    .filter((c) => c.count > 0)
}

function MyPrsTab() {
  const [allPRs, setAllPRs] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMine = async () => {
    try {
      setLoading(true)
      setError(null)

      const data = await apiGet<{
        mine?: { items?: Array<Record<string, unknown>>; message?: string } | null
        username: string
      }>('pull-requests-mine')

      const mine = data.mine || { items: [] }

      if (mine.message && !mine.items) {
        throw new Error(mine.message)
      }

      const items = Array.isArray(mine.items) ? mine.items : []
      setAllPRs(items.map(mapItem))
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to fetch your pull requests')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMine()
  }, [])

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading your pull requests...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-message">{error}</p>
        <button onClick={fetchMine} className="retry-button">
          Try Again
        </button>
      </div>
    )
  }

  if (allPRs.length === 0) {
    return (
      <div className="empty-state">
        <svg className="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>
        </svg>
        <h2>No PRs</h2>
        <p>You don't have any open pull requests you've created or are assigned to.</p>
      </div>
    )
  }

  const categories = buildCategories(allPRs)

  return (
    <div className="mine-container">
      {categories.map((category) => (
        <section key={category.key} className={`mine-section ${category.className}`}>
          <div className="mine-section-header">
            <h2 className="mine-section-title">{category.label}</h2>
            <span className="mine-section-count">{category.count}</span>
          </div>
          <div className="orgs-container">
            {category.orgPRs.map((orgData) => (
              <div key={orgData.org} className="org-section">
                <div className="org-header">
                  <h2 className="org-name">{orgData.org}</h2>
                  <span className="org-count">
                    {orgData.pullRequests.length} PR{orgData.pullRequests.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="prs-list">
                  {orgData.pullRequests.map((pr) => (
                    <PRCard key={pr.id} pr={pr} showState={false} showAge />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default MyPrsTab
