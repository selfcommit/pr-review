import { describe, it, expect } from 'vitest'
import { decideReviewedState, type PullRequestGraph } from './reviewedState'

const NO_TEAMS = new Set<string>()

function pr(overrides: Partial<PullRequestGraph> = {}): PullRequestGraph {
  return {
    reviews: { nodes: [] },
    timelineItems: { nodes: [] },
    ...overrides,
  }
}

describe('decideReviewedState — the card must leave the moment the viewer finishes their review', () => {
  // Regression: PR 6978. Viewer (selfcommit) self-requested a review 4h ago and
  // just approved. The routine used to silently swallow the verdict, leaving
  // the card on screen forever until a full page refresh.
  it('drops the card when the viewer self-requested then self-approved', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'selfcommit' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T17:21:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T13:21:00Z',
              requestedReviewer: { __typename: 'User', login: 'selfcommit' },
            },
          ],
        },
      }),
      'selfcommit',
      NO_TEAMS,
    )
    expect(verdict).toEqual({ reviewed: true, state: 'approved' })
  })

  it('drops the card when the viewer just requested changes', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'CHANGES_REQUESTED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T12:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict).toEqual({ reviewed: true, state: 'changes_requested' })
  })

  it('drops the card when the viewer left a plain comment review', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'COMMENTED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T12:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict).toEqual({ reviewed: true, state: 'commented' })
  })

  it('keeps the card visible when a bot re-added the viewer as reviewer after their approval', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T15:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T10:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
            {
              createdAt: '2026-08-11T16:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict.reviewed).toBe(false)
  })

  it('credits a team review against a team request when the viewer is a member', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T12:00:00Z',
              requestedReviewer: {
                __typename: 'Team',
                slug: 'reviewers',
                organization: { login: 'acme' },
              },
            },
          ],
        },
      }),
      'octo',
      new Set(['acme/reviewers']),
    )
    expect(verdict).toEqual({ reviewed: true, state: 'approved' })
  })

  it('ignores a team request against a team the viewer does not belong to', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T18:00:00Z',
              requestedReviewer: {
                __typename: 'Team',
                slug: 'other-team',
                organization: { login: 'acme' },
              },
            },
          ],
        },
      }),
      'octo',
      new Set(['acme/reviewers']),
    )
    // The viewer's own approval still stands because the later team request
    // was directed at a team they are not on.
    expect(verdict.reviewed).toBe(true)
  })

  it('does not crash when the timeline field is missing', () => {
    const verdict = decideReviewedState(
      { reviews: { nodes: [{ author: { login: 'octo' }, state: 'APPROVED', submittedAt: '2026-08-11T17:00:00Z' }] } },
      'octo',
      NO_TEAMS,
    )
    expect(verdict.reviewed).toBe(true)
  })

  it('does not crash when the reviews field is missing', () => {
    const verdict = decideReviewedState({}, 'octo', NO_TEAMS)
    expect(verdict.reviewed).toBe(false)
  })

  it('does not crash when the PR fragment itself is null', () => {
    const verdict = decideReviewedState(null, 'octo', NO_TEAMS)
    expect(verdict).toEqual({ reviewed: false, state: '' })
  })

  it('picks the most recent terminal review when the viewer has many on the same PR', () => {
    const reviews = []
    // 120 comment reviews over the past two hours, then a final approval.
    for (let i = 0; i < 120; i++) {
      reviews.push({
        author: { login: 'octo' },
        state: 'COMMENTED',
        submittedAt: new Date(1_700_000_000_000 + i * 60_000).toISOString(),
      })
    }
    reviews.push({
      author: { login: 'octo' },
      state: 'APPROVED',
      submittedAt: new Date(1_700_000_000_000 + 200 * 60_000).toISOString(),
    })
    const verdict = decideReviewedState(
      pr({
        reviews: { nodes: reviews },
        timelineItems: {
          nodes: [
            {
              createdAt: new Date(1_700_000_000_000 - 60_000).toISOString(),
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict).toEqual({ reviewed: true, state: 'approved' })
  })

  it('ignores review events from other users', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'someone-else' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T12:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict.reviewed).toBe(false)
  })

  it('ignores non-terminal review states like PENDING or DISMISSED', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'octo' },
              state: 'PENDING',
              submittedAt: '2026-08-11T17:00:00Z',
            },
            {
              author: { login: 'octo' },
              state: 'DISMISSED',
              submittedAt: '2026-08-11T18:00:00Z',
            },
          ],
        },
        timelineItems: {
          nodes: [
            {
              createdAt: '2026-08-11T12:00:00Z',
              requestedReviewer: { __typename: 'User', login: 'octo' },
            },
          ],
        },
      }),
      'octo',
      NO_TEAMS,
    )
    expect(verdict.reviewed).toBe(false)
  })

  it('is case-insensitive on the viewer login', () => {
    const verdict = decideReviewedState(
      pr({
        reviews: {
          nodes: [
            {
              author: { login: 'Octo' },
              state: 'APPROVED',
              submittedAt: '2026-08-11T17:00:00Z',
            },
          ],
        },
      }),
      'OCTO',
      NO_TEAMS,
    )
    expect(verdict.reviewed).toBe(true)
  })
})
