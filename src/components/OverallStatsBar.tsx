import { useEffect, useState, useCallback } from 'react'
import { apiGet } from '../utils/api'
import { StatsResponse } from '../types/stats'
import { StatRow, PrDrawer } from './StatsTab'

const CACHE_KEY = 'stats_cache'

function readCache(): StatsResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeCache(data: StatsResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch { /* quota exceeded is fine */ }
}

const EMPTY_SUMMARY: StatsResponse = {
  summary: {
    total_reviews: 0,
    approved: 0,
    changes_requested: 0,
    commented: 0,
    declined: 0,
    p90_latency_seconds: null,
    latency_sample_size: 0,
    prs: [],
    excluded_prs: [],
  },
  repos: [],
  window_days: 120,
}

function OverallStatsBar() {
  const [data, setData] = useState<StatsResponse>(() => readCache() || EMPTY_SUMMARY)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setRefreshing(true)
      const resp = await apiGet<StatsResponse>('stats')
      setData(resp)
      writeCache(resp)
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const windowDays = data.window_days ?? 120
  const summary = data.summary
  const prs = summary.prs || []
  const excludedPrs = summary.excluded_prs || []

  return (
    <div className="overall-stats-bar">
      <div className="stats-section-header">
        <h2 className="stats-section-title">All Repositories (last {windowDays} days)</h2>
        <button
          className="stats-refresh-btn"
          onClick={load}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Stats'}
        </button>
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
        latencySampleSize={summary.latency_sample_size}
        showRepo
      />
    </div>
  )
}

export default OverallStatsBar
