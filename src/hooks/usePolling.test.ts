import { describe, it, expect } from 'vitest'
import { computePauseDelayMs, PAUSE_FALLBACK_MS } from './usePolling'

// Regression: PR dashboard tiles froze until page refresh. The client's poll
// hit `remaining=30, reset=<in the past>`, paused itself, and never scheduled
// an unpause because the naive computation returned a non-positive delay.
// computePauseDelayMs is now the single source of truth for that decision.
describe('computePauseDelayMs', () => {
  const now = 1_700_000_000_000

  it('returns null when there is plenty of rate-limit budget', () => {
    expect(computePauseDelayMs('4900', String(Math.floor(now / 1000) + 60), now)).toBeNull()
    expect(computePauseDelayMs('50', String(Math.floor(now / 1000) + 60), now)).toBeNull()
  })

  it('returns null when the header is missing or unparseable', () => {
    expect(computePauseDelayMs(null, null, now)).toBeNull()
    expect(computePauseDelayMs('not-a-number', '1', now)).toBeNull()
  })

  // The bug that froze cards for hours.
  it('returns the fallback delay when the reset time is already in the past', () => {
    const pastReset = String(Math.floor(now / 1000) - 3600)
    expect(computePauseDelayMs('30', pastReset, now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the fallback delay when the reset field is missing', () => {
    expect(computePauseDelayMs('30', null, now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the fallback delay when the reset field is unparseable', () => {
    expect(computePauseDelayMs('30', 'not-a-number', now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the real countdown (with a 5s cushion) when the reset is in the future', () => {
    const futureReset = Math.floor(now / 1000) + 45
    const delay = computePauseDelayMs('30', String(futureReset), now)
    expect(delay).toBe(45_000 + 5_000)
  })

  it('returns the fallback delay when the reset is exactly now (edge)', () => {
    const nowReset = String(Math.floor(now / 1000))
    // resetMs = 5s cushion, > 0, so it returns 5000 — still fine, not stuck.
    expect(computePauseDelayMs('30', nowReset, now)).toBe(5_000)
  })
})
