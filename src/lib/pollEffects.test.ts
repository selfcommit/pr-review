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
