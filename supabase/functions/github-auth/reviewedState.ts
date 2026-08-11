// Pure decision layer for "has this viewer finished their review?". Kept
// dependency-free so vitest (Node) and the deployed edge function (Deno) can
// both execute the exact same code path — the bug that lingered a card on
// screen after the viewer approved it lived in this decision.

export interface ReviewNode {
  author?: { login?: string | null } | null
  state?: string | null
  submittedAt?: string | null
}

export interface TimelineNode {
  createdAt?: string | null
  requestedReviewer?:
    | {
        __typename?: string
        login?: string | null
        slug?: string | null
        organization?: { login?: string | null } | null
      }
    | null
}

export interface PullRequestGraph {
  reviews?: { nodes?: (ReviewNode | null)[] | null } | null
  timelineItems?: { nodes?: (TimelineNode | null)[] | null } | null
}

export interface ReviewedVerdict {
  reviewed: boolean
  state: string
}

const TERMINAL_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'])

export function decideReviewedState(
  pr: PullRequestGraph | null | undefined,
  viewerLogin: string,
  viewerTeamKeys: ReadonlySet<string>,
): ReviewedVerdict {
  if (!pr) return { reviewed: false, state: '' }

  const loginLower = viewerLogin.toLowerCase()
  const reviewNodes = Array.isArray(pr.reviews?.nodes) ? pr.reviews!.nodes! : []

  let latestReviewAt: number | null = null
  let latestState = ''
  for (const review of reviewNodes) {
    if (!review) continue
    const authorLogin = review.author?.login
    if (!authorLogin || authorLogin.toLowerCase() !== loginLower) continue
    if (!review.submittedAt || !review.state) continue
    if (!TERMINAL_STATES.has(review.state)) continue
    const ts = Date.parse(review.submittedAt)
    if (Number.isNaN(ts)) continue
    if (latestReviewAt === null || ts >= latestReviewAt) {
      latestReviewAt = ts
      latestState = review.state.toLowerCase()
    }
  }

  if (latestReviewAt === null) {
    return { reviewed: false, state: '' }
  }

  const timelineNodes = Array.isArray(pr.timelineItems?.nodes)
    ? pr.timelineItems!.nodes!
    : []

  let latestRequestAt: number | null = null
  for (const ev of timelineNodes) {
    if (!ev || !ev.createdAt) continue
    const rev = ev.requestedReviewer
    if (!rev) continue
    let relevant = false
    if (rev.__typename === 'User') {
      relevant = (rev.login || '').toLowerCase() === loginLower
    } else if (
      rev.__typename === 'Team' &&
      rev.slug &&
      rev.organization?.login
    ) {
      const key = `${rev.organization.login.toLowerCase()}/${rev.slug.toLowerCase()}`
      relevant = viewerTeamKeys.has(key)
    }
    if (!relevant) continue
    const ts = Date.parse(ev.createdAt)
    if (Number.isNaN(ts)) continue
    if (latestRequestAt === null || ts > latestRequestAt) {
      latestRequestAt = ts
    }
  }

  const reviewed = latestRequestAt === null || latestReviewAt >= latestRequestAt
  return { reviewed, state: reviewed ? latestState : '' }
}
