import { StatsResponse } from '../types/stats'
import { StatRow, PrDrawer } from './StatsTab'
import { useStats } from '../hooks/useStats'

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
  const { data, refreshing, refresh } = useStats()
  const resolved = data ?? EMPTY_SUMMARY

  const windowDays = resolved.window_days ?? 120
  const summary = resolved.summary
  const prs = summary.prs || []
  const excludedPrs = summary.excluded_prs || []

  return (
    <div className="overall-stats-bar">
      <div className="stats-section-header">
        <h2 className="stats-section-title">All Repositories (last {windowDays} days)</h2>
        <button
          className="stats-refresh-btn"
          onClick={refresh}
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
