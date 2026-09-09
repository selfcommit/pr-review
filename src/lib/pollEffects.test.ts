import { describe, it, expect } from 'vitest'
import { computePollEffects, PollInput, PollState } from './pollEffects'

function makeRaw(id: number, opts: Partial<{ title: string; repo: string; updated_at: string }> = {}) {
  const repo = opts.repo || 'acme/widgets'
  const [, repoName] = repo.split('/')
  return {
    id,
    title: opts.title || `PR ${id}`,
    html_url: `https://github.com/${repo}/pull/${id}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: opts.updated_at || '2026-01-01T00:00:00Z',
    state: 'open',
    user: { login: 'octo', avatar_url: '' },
    draft: false,
    repository_name: repoName,
  } as Record<string, unknown>
}

function emptyState(overrides: Partial<PollState> = {}): PollState {
  return {
    items: [],
    reviewTimestamps: {},
    overdueNotified: new Set<number>(),
    ...overrides,
  }
}

function emptyResult(overrides: Partial<PollInput> = {}): PollInput {
  return {
    updatedPRs: [],
    removedPRIds: [],
    removalReasons: {},
    newPRs: [],
    reviewTimestamps: {},
    ...overrides,
  }
}

describe('poll effects — new review requests', () => {
  it('adds a new card when a review is requested', () => {
    const effects = computePollEffects(emptyState(), emptyResult({ newPRs: [makeRaw(1)] }))
    expect(effects.nextItems).toHaveLength(1)
    expect((effects.nextItems[0] as { id: number }).id).toBe(1)
  })

  it('emits a toast notification for a new card', () => {
    const effects = computePollEffects(
      emptyState(),
      emptyResult({ newPRs: [makeRaw(42, { title: 'Fix login', repo: 'acme/api' })] }),
    )
    expect(effects.notifications).toEqual([
      { prId: 42, text: 'acme/api: Fix login' },
    ])
    expect(effects.highlightedIds).toEqual([42])
  })

  it('does not fire the new-request path when nothing new arrived', () => {
    const effects = computePollEffects(emptyState(), emptyResult())
    expect(effects.notifications).toHaveLength(0)
    expect(effects.highlightedIds).toHaveLength(0)
  })
})

describe('poll effects — review completed', () => {
  it('removes a card when the review was performed', () => {
    const existing = makeRaw(7)
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({ removedPRIds: [7], removalReasons: { 7: 'approved' } }),
    )
    expect(effects.nextItems).toHaveLength(0)
  })

  it('signals the removal chime when an on-screen card leaves', () => {
    const existing = makeRaw(7)
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({ removedPRIds: [7], removalReasons: { 7: 'approved' } }),
    )
    expect(effects.playRemovalChime).toBe(true)
  })

  it('does not signal a chime for a card that was never on screen', () => {
    const effects = computePollEffects(
      emptyState(),
      emptyResult({ removedPRIds: [7], removalReasons: { 7: 'approved' } }),
    )
    expect(effects.playRemovalChime).toBe(false)
  })

  it('does not re-signal a chime on a later poll after the card is gone', () => {
    const first = computePollEffects(
      emptyState({ items: [makeRaw(7)] }),
      emptyResult({ removedPRIds: [7], removalReasons: { 7: 'approved' } }),
    )
    expect(first.playRemovalChime).toBe(true)

    const second = computePollEffects(
      emptyState({ items: first.nextItems }),
      emptyResult({ removedPRIds: [7], removalReasons: { 7: 'approved' } }),
    )
    expect(second.playRemovalChime).toBe(false)
    expect(Object.keys(second.statsIncrements)).toHaveLength(0)
  })
})

describe('poll effects — stats increments', () => {
  it('increments the matching stat when a card is approved', () => {
    const effects = computePollEffects(
      emptyState({ items: [makeRaw(1)] }),
      emptyResult({ removedPRIds: [1], removalReasons: { 1: 'approved' } }),
    )
    expect(effects.statsIncrements).toEqual({ approved: 1 })
  })

  it('increments each tracked reason exactly once per card', () => {
    const effects = computePollEffects(
      emptyState({ items: [makeRaw(1), makeRaw(2), makeRaw(3), makeRaw(4)] }),
      emptyResult({
        removedPRIds: [1, 2, 3, 4],
        removalReasons: {
          1: 'approved',
          2: 'commented',
          3: 'changes_requested',
          4: 'closed',
        },
      }),
    )
    expect(effects.statsIncrements).toEqual({
      approved: 1,
      commented: 1,
      changes_requested: 1,
    })
  })
})

describe('poll effects — visibility reconciliation', () => {
  it('prunes cards that the server no longer considers visible', () => {
    const effects = computePollEffects(
      emptyState({ items: [makeRaw(1), makeRaw(2), makeRaw(3)] }),
      emptyResult({ visibleIds: [1, 3] }),
    )
    const ids = effects.nextItems.map(i => (i as { id: number }).id)
    expect(ids).toEqual([1, 3])
  })
})

// Regression coverage for the "card lingered after approval" bug: the server
// now proactively signals removal the moment it detects a terminal review
// (approved, changes requested, commented), even if GitHub's search index
// is stale and still lists the PR as review-requested for a few minutes.
describe('poll effects — removal wins over a stale visible list', () => {
  it('drops the card even when the server still lists it inside visibleIds', () => {
    const existing = makeRaw(6978)
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({
        removedPRIds: [6978],
        removalReasons: { 6978: 'approved' },
        visibleIds: [6978],
      }),
    )
    expect(effects.nextItems).toHaveLength(0)
    expect(effects.playRemovalChime).toBe(true)
    expect(effects.statsIncrements).toEqual({ approved: 1 })
  })

  it('drops the card for a changes-requested terminal state', () => {
    const existing = makeRaw(6978)
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({
        removedPRIds: [6978],
        removalReasons: { 6978: 'changes_requested' },
        visibleIds: [6978],
      }),
    )
    expect(effects.nextItems).toHaveLength(0)
    expect(effects.playRemovalChime).toBe(true)
    expect(effects.statsIncrements).toEqual({ changes_requested: 1 })
  })

  it('drops the card for a plain-comment terminal state', () => {
    const existing = makeRaw(6978)
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({
        removedPRIds: [6978],
        removalReasons: { 6978: 'commented' },
        visibleIds: [6978],
      }),
    )
    expect(effects.nextItems).toHaveLength(0)
    expect(effects.statsIncrements).toEqual({ commented: 1 })
  })

  it('does not double-fire the chime when two consecutive polls both include the removed id', () => {
    const first = computePollEffects(
      emptyState({ items: [makeRaw(6978)] }),
      emptyResult({
        removedPRIds: [6978],
        removalReasons: { 6978: 'approved' },
        visibleIds: [6978],
      }),
    )
    expect(first.playRemovalChime).toBe(true)
    const second = computePollEffects(
      { items: first.nextItems, reviewTimestamps: {}, overdueNotified: new Set<number>() },
      emptyResult({
        removedPRIds: [6978],
        removalReasons: { 6978: 'approved' },
        visibleIds: [6978],
      }),
    )
    expect(second.playRemovalChime).toBe(false)
  })
})

// Regression coverage for the "tagged but no card appeared" bug: the badge
// updated on its own while the review-requested list never re-rendered the
// newly arrived pull request. Every scenario below reproduces one of the
// server-response shapes that used to silently drop a fresh arrival.
describe('poll effects — fresh arrivals must never be dropped', () => {
  it('adds the card when the server bucketed it as updated but the client had never seen it', () => {
    const effects = computePollEffects(
      emptyState({ items: [] }),
      emptyResult({ updatedPRs: [makeRaw(6984, { title: 'Ship live updates', repo: 'acme/dash' })] }),
    )
    const ids = effects.nextItems.map(i => (i as { id: number }).id)
    expect(ids).toContain(6984)
  })

  it('fires a toast and highlight when a fresh arrival came in on the updated bucket', () => {
    const effects = computePollEffects(
      emptyState({ items: [] }),
      emptyResult({ updatedPRs: [makeRaw(6984, { title: 'Ship live updates', repo: 'acme/dash' })] }),
    )
    expect(effects.notifications).toEqual([
      { prId: 6984, text: 'acme/dash: Ship live updates' },
    ])
    expect(effects.highlightedIds).toEqual([6984])
  })

  it('never renders the same arrival twice when the server included it in both buckets', () => {
    const raw = makeRaw(42)
    const effects = computePollEffects(
      emptyState(),
      emptyResult({ newPRs: [raw], updatedPRs: [raw] }),
    )
    const ids = effects.nextItems.map(i => (i as { id: number }).id)
    expect(ids.filter(id => id === 42)).toHaveLength(1)
    expect(effects.notifications).toHaveLength(1)
  })

  it('does not swallow arrivals just because visibleIds also lists them', () => {
    const raw = makeRaw(77)
    const effects = computePollEffects(
      emptyState(),
      emptyResult({ newPRs: [raw], visibleIds: [77] }),
    )
    const ids = effects.nextItems.map(i => (i as { id: number }).id)
    expect(ids).toEqual([77])
  })

  it('handles two consecutive polls each delivering a different fresh request', () => {
    const first = computePollEffects(
      emptyState(),
      emptyResult({ newPRs: [makeRaw(1)] }),
    )
    const second = computePollEffects(
      { items: first.nextItems, reviewTimestamps: {}, overdueNotified: new Set<number>() },
      emptyResult({ updatedPRs: [makeRaw(2)] }),
    )
    const ids = second.nextItems.map(i => (i as { id: number }).id)
    expect(ids).toContain(1)
    expect(ids).toContain(2)
    expect(second.notifications).toEqual([
      { prId: 2, text: 'acme/widgets: PR 2' },
    ])
  })

  it('still updates the existing card in place when the server bucketed a known id as updated', () => {
    const existing = makeRaw(5, { title: 'Old title' })
    const updated = makeRaw(5, { title: 'New title' })
    const effects = computePollEffects(
      emptyState({ items: [existing] }),
      emptyResult({ updatedPRs: [updated] }),
    )
    expect(effects.nextItems).toHaveLength(1)
    expect((effects.nextItems[0] as { title: string }).title).toBe('New title')
    expect(effects.notifications).toHaveLength(0)
  })
})

describe('poll effects — overdue transitions', () => {
  it('emits a toast when a card crosses the 24-hour mark', () => {
    const now = Date.now()
    const oldTs = new Date(now - 23 * 60 * 60 * 1000).toISOString()
    const newTs = new Date(now - 25 * 60 * 60 * 1000).toISOString()

    const effects = computePollEffects(
      emptyState({
        items: [makeRaw(9)],
        reviewTimestamps: { 9: oldTs },
      }),
      emptyResult({ reviewTimestamps: { 9: newTs } }),
    )

    expect(effects.overdueNotifiedAdditions).toEqual([9])
    expect(effects.notifications).toHaveLength(1)
    expect(effects.notifications[0].text).toContain('24h+')
  })

  it('does not re-notify a card that was already notified as overdue', () => {
    const now = Date.now()
    const oldTs = new Date(now - 25 * 60 * 60 * 1000).toISOString()
    const newTs = new Date(now - 26 * 60 * 60 * 1000).toISOString()

    const effects = computePollEffects(
      emptyState({
        items: [makeRaw(9)],
        reviewTimestamps: { 9: oldTs },
        overdueNotified: new Set<number>([9]),
      }),
      emptyResult({ reviewTimestamps: { 9: newTs } }),
    )

    expect(effects.notifications).toHaveLength(0)
    expect(effects.overdueNotifiedAdditions).toHaveLength(0)
  })
})

describe('poll effects — no notification for hidden-by-default items', () => {
  it('does not fire a toast or chime for a draft PR arriving in newPRs', () => {
    const draft = { ...makeRaw(11), draft: true }
    const effects = computePollEffects(emptyState(), emptyResult({ newPRs: [draft] }))
    expect(effects.notifications).toHaveLength(0)
    expect(effects.highlightedIds).toHaveLength(0)
  })

  it('still adds the draft card to nextItems so the filter toggle works', () => {
    const draft = { ...makeRaw(12), draft: true }
    const effects = computePollEffects(emptyState(), emptyResult({ newPRs: [draft] }))
    const ids = effects.nextItems.map(i => (i as { id: number }).id)
    expect(ids).toContain(12)
  })

  it('does not fire a toast for a draft PR arriving in updatedPRs (fresh arrival path)', () => {
    const draft = { ...makeRaw(13), draft: true }
    const effects = computePollEffects(emptyState(), emptyResult({ updatedPRs: [draft] }))
    expect(effects.notifications).toHaveLength(0)
    expect(effects.highlightedIds).toHaveLength(0)
  })

  it('does not fire a toast for a PR with team_approval_required: false', () => {
    const teamApproved = { ...makeRaw(14), team_approval_required: false }
    const effects = computePollEffects(emptyState(), emptyResult({ newPRs: [teamApproved] }))
    expect(effects.notifications).toHaveLength(0)
    expect(effects.highlightedIds).toHaveLength(0)
  })

  it('does fire a toast for a non-draft PR with team_approval_required: true', () => {
    const normal = { ...makeRaw(15), draft: false, team_approval_required: true }
    const effects = computePollEffects(emptyState(), emptyResult({ newPRs: [normal] }))
    expect(effects.notifications).toHaveLength(1)
    expect(effects.highlightedIds).toEqual([15])
  })
})
