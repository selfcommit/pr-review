export type ActivityEventType = 'approved' | 'changes_requested' | 'commented' | 'declined'

export interface ActivityEvent {
  pr_id: number
  pr_number: number
  pr_title: string
  pr_html_url: string
  repo_full_name: string
  event_type: ActivityEventType
  timestamp: string
}

export interface ActivityResponse {
  events: ActivityEvent[]
  days: number
}
