interface StatsPR {
  pr_id: number
  pr_number: number
  title: string
  html_url: string
  latency_seconds: number
  review_state: string
  submitted_at: string
}

export interface RepoStats {
  repo: string
  total_reviews: number
  approved: number
  changes_requested: number
  commented: number
  declined: number
  p90_latency_seconds: number | null
  latency_sample_size: number
  prs: StatsPR[]
  excluded_prs: StatsPR[]
}

export interface StatsSummary {
  total_reviews: number
  approved: number
  changes_requested: number
  commented: number
  declined: number
  p90_latency_seconds: number | null
  latency_sample_size: number
}

export interface StatsResponse {
  summary: StatsSummary
  repos: RepoStats[]
  window_days?: number
  backfilled_at?: string | null
}

export function formatLatency(seconds: number | null): string {
  if (seconds == null) return '—'
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60)
    return `${mins}m`
  }
  const hours = seconds / 3600
  if (hours < 48) {
    return `${hours.toFixed(1)}h`
  }
  const days = hours / 24
  return `${days.toFixed(1)}d`
}
