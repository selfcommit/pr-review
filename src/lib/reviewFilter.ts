import type { PullRequest } from '../types/pullRequest'

export interface ReviewFilterOptions {
  showDrafts: boolean
  showTeamApproved: boolean
  locallyDeclinedIds?: Set<number>
}

export interface ReviewFilterResult {
  visible: PullRequest[]
  draftCount: number
  teamApprovedCount: number
  hidden: {
    declined: number
    draft: number
    teamApproved: number
  }
}

// Single source of truth for what the review-requested tab shows. Both the
// tab body and the tab badge derive from this, so the count and the card
// list can never silently drift apart.
export function applyReviewFilters(
  prs: PullRequest[],
  { showDrafts, showTeamApproved, locallyDeclinedIds }: ReviewFilterOptions,
): ReviewFilterResult {
  const declined = new Set(locallyDeclinedIds ?? [])
  let declinedHidden = 0
  const afterDecline: PullRequest[] = []
  for (const pr of prs) {
    if (declined.has(pr.id)) {
      declinedHidden++
      continue
    }
    afterDecline.push(pr)
  }

  const draftCount = afterDecline.filter(pr => pr.draft).length
  const afterDraft = showDrafts ? afterDecline : afterDecline.filter(pr => !pr.draft)
  const draftHidden = afterDecline.length - afterDraft.length

  const teamApprovedCount = afterDraft.filter(pr => pr.team_approval_required === false).length
  const visible = showTeamApproved
    ? afterDraft
    : afterDraft.filter(pr => pr.team_approval_required !== false)
  const teamApprovedHidden = afterDraft.length - visible.length

  return {
    visible,
    draftCount,
    teamApprovedCount,
    hidden: {
      declined: declinedHidden,
      draft: draftHidden,
      teamApproved: teamApprovedHidden,
    },
  }
}
