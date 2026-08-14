import { useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import { formatWaitTime } from '../utils/time'
import { useNow } from '../hooks/useNow'
import type { ActivityEvent, ActivityEventType, ActivityResponse } from '../types/activity'

const EVENT_LABELS: Record<ActivityEventType, string> = {
  approved: 'Approved',
  changes_requested: 'Changes Req.',
  commented: 'Comment',
  declined: 'Declined',
}

const WINDOW_STEPS = [7, 14, 30]

function RecentActivity() {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [loadingMore, setLoadingMore] = useState(false)
  const [activeFilters, setActiveFilters] = useState<Set<ActivityEventType>>(
    () => new Set(['approved', 'changes_requested', 'commented', 'declined'])
  )
  useNow(30000)

  const load = async (windowDays: number, isExpand = false) => {
    try {
      if (isExpand) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }
      setError(null)
      const resp = await apiGet<ActivityResponse>(`activity?days=${windowDays}`)
      setEvents(resp.events)
      setDays(resp.days)
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    load(7)
  }, [])

  const toggleFilter = (type: ActivityEventType) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const handleLoadMore = () => {
    const currentIdx = WINDOW_STEPS.indexOf(days)
    const nextDays = currentIdx >= 0 && currentIdx < WINDOW_STEPS.length - 1
      ? WINDOW_STEPS[currentIdx + 1]
      : Math.min(days * 2, 30)
    load(nextDays, true)
  }

  const filteredEvents = events.filter(e => activeFilters.has(e.event_type))
  const canLoadMore = days < 30

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner"></div>
        <p>Loading activity...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-state">
        <p className="error-message">{error}</p>
        <button onClick={() => load(days)} className="retry-button">Try Again</button>
      </div>
    )
  }

  const filterTypes: ActivityEventType[] = ['approved', 'changes_requested', 'commented', 'declined']

  return (
    <div className="activity-container">
      <div className="activity-header">
        <div className="activity-filter-bar">
          {filterTypes.map(type => (
            <button
              key={type}
              className={`activity-filter-pill activity-filter-${type} ${activeFilters.has(type) ? 'activity-filter-active' : ''}`}
              onClick={() => toggleFilter(type)}
            >
              {type === 'declined' && <span className="activity-filter-icon" aria-label="runner">🏃</span>}
              {EVENT_LABELS[type]}
            </button>
          ))}
        </div>
        <div className="activity-header-right">
          <span className="activity-window-label">Last {days} days</span>
          {canLoadMore && (
            <button
              className="activity-load-more"
              onClick={handleLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading...' : 'Load older'}
            </button>
          )}
        </div>
      </div>

      <div className="activity-scroll-container">
        {filteredEvents.length === 0 ? (
          <div className="activity-empty">
            <p>No activity found for the selected filters.</p>
          </div>
        ) : (
          <div className="activity-list">
            {filteredEvents.map((event, i) => (
              <a
                key={`${event.pr_id}-${event.event_type}-${event.timestamp}-${i}`}
                href={event.pr_html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="activity-event-row"
              >
                <span className={`activity-event-badge activity-badge-${event.event_type}`}>
                  {event.event_type === 'declined' && <span aria-label="runner">🏃</span>}
                  {EVENT_LABELS[event.event_type]}
                </span>
                <span className="activity-event-repo">
                  {event.repo_full_name.split('/')[1] || event.repo_full_name}
                </span>
                <span className="activity-event-number">#{event.pr_number}</span>
                <span className="activity-event-title">{event.pr_title || '(no title)'}</span>
                <span className="activity-event-time">{formatWaitTime(event.timestamp)} ago</span>
              </a>
            ))}
          </div>
        )}
      </div>

    </div>
  )
}

export default RecentActivity
