import { describe, it, expect } from 'vitest'
import type { PullRequest } from '../types/pullRequest'
import { applyReviewFilters } from './reviewFilter'

function makePR(id: number, overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id,
    title: `PR ${id}`,
    html_url: `https://github.com/acme/dash/pull/${id}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    state: 'open',
    pull_request_merged: false,
    repository: { name: 'dash', full_name: 'acme/dash', html_url: 'https://github.com/acme/dash' },
    user: { login: 'octo', avatar_url: '' },
    draft: false,
    ...overrides,
  }
}

describe('applyReviewFilters — badge and list share a source of truth', () => {
  it('shows a freshly tagged PR whose team-approval status is not known yet', () => {
    const prs = [makePR(1), makePR(2), makePR(6984)]
    const result = applyReviewFilters(prs, { showDrafts: false, showTeamApproved: false })
    expect(result.visible.map(pr => pr.id)).toEqual([1, 2, 6984])
  })

  it('keeps a PR that explicitly still needs review even with the team-reviewed toggle off', () => {
    const prs = [makePR(1, { team_approval_required: true })]
    const result = applyReviewFilters(prs, { showDrafts: false, showTeamApproved: false })
    expect(result.visible).toHaveLength(1)
  })

  it('hides only the PRs the server marked as team-reviewed when the toggle is off', () => {
    const prs = [
      makePR(1),
      makePR(2, { team_approval_required: false }),
      makePR(3, { team_approval_required: true }),
    ]
    const result = applyReviewFilters(prs, { showDrafts: false, showTeamApproved: false })
    expect(result.visible.map(pr => pr.id)).toEqual([1, 3])
    expect(result.teamApprovedCount).toBe(1)
    expect(result.hidden.teamApproved).toBe(1)
  })

  it('never hides a non-draft, non-team-reviewed PR by default', () => {
    const prs = [makePR(1), makePR(2), makePR(3)]
    const result = applyReviewFilters(prs, { showDrafts: false, showTeamApproved: false })
    expect(result.visible).toHaveLength(3)
    expect(result.hidden).toEqual({ declined: 0, draft: 0, teamApproved: 0 })
  })

  it('reveals drafts when the drafts toggle is on', () => {
    const prs = [makePR(1, { draft: true }), makePR(2)]
    const off = applyReviewFilters(prs, { showDrafts: false, showTeamApproved: false })
    const on = applyReviewFilters(prs, { showDrafts: true, showTeamApproved: false })
    expect(off.visible.map(pr => pr.id)).toEqual([2])
    expect(on.visible.map(pr => pr.id)).toEqual([1, 2])
    expect(off.draftCount).toBe(1)
  })

  it('drops locally declined PRs before any other filter runs', () => {
    const prs = [makePR(1), makePR(2)]
    const result = applyReviewFilters(prs, {
      showDrafts: false,
      showTeamApproved: false,
      locallyDeclinedIds: new Set([1]),
    })
    expect(result.visible.map(pr => pr.id)).toEqual([2])
    expect(result.hidden.declined).toBe(1)
  })

  it('the sum of visible plus hidden always equals the incoming list — no PR vanishes silently', () => {
    const prs = [
      makePR(1),
      makePR(2, { draft: true }),
      makePR(3, { team_approval_required: false }),
      makePR(4),
    ]
    const result = applyReviewFilters(prs, {
      showDrafts: false,
      showTeamApproved: false,
      locallyDeclinedIds: new Set([4]),
    })
    const hiddenTotal =
      result.hidden.declined + result.hidden.draft + result.hidden.teamApproved
    expect(result.visible.length + hiddenTotal).toBe(prs.length)
  })
})
