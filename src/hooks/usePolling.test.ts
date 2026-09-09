import { describe, it, expect } from 'vitest'
import {
  computePauseDelayMs,
  computeNextIntervalMs,
  computeErrorIntervalMs,
  PAUSE_FALLBACK_MS,
  RATE_LIMIT_PAUSE_THRESHOLD,
  IDLE_BACKOFF_STEPS,
  HIDDEN_INTERVAL_MS,
  ERROR_BACKOFF_CAP_MS,
} from './usePolling'

// Regression: PR dashboard tiles froze until page refresh, and a follow-up
// bug had the "Paused" banner tripping on every response because the pause
// threshold (50) was higher than the Search API's whole budget (30/min).
describe('computePauseDelayMs', () => {
  const now = 1_700_000_000_000

  it('does not pause on healthy Search API budgets (25 of 30 remaining)', () => {
    expect(computePauseDelayMs('25', String(Math.floor(now / 1000) + 60), now)).toBeNull()
  })

  it('does not pause at the threshold boundary', () => {
    expect(
      computePauseDelayMs(String(RATE_LIMIT_PAUSE_THRESHOLD), String(Math.floor(now / 1000) + 60), now),
    ).toBeNull()
  })

  it('only pauses when budget is genuinely low', () => {
    const belowThreshold = String(RATE_LIMIT_PAUSE_THRESHOLD - 1)
    expect(computePauseDelayMs(belowThreshold, String(Math.floor(now / 1000) + 30), now)).not.toBeNull()
  })

  it('returns null when the header is missing or unparseable', () => {
    expect(computePauseDelayMs(null, null, now)).toBeNull()
    expect(computePauseDelayMs('not-a-number', '1', now)).toBeNull()
  })

  it('returns the fallback delay when the reset time is already in the past', () => {
    const pastReset = String(Math.floor(now / 1000) - 3600)
    expect(computePauseDelayMs('1', pastReset, now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the fallback delay when the reset field is missing', () => {
    expect(computePauseDelayMs('1', null, now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the fallback delay when the reset field is unparseable', () => {
    expect(computePauseDelayMs('1', 'not-a-number', now)).toBe(PAUSE_FALLBACK_MS)
  })

  it('returns the real countdown (with a 5s cushion) when the reset is in the future', () => {
    const futureReset = Math.floor(now / 1000) + 45
    const delay = computePauseDelayMs('1', String(futureReset), now)
    expect(delay).toBe(45_000 + 5_000)
  })
})

describe('computeNextIntervalMs — spend less budget when nothing is changing', () => {
  const base = 5000

  it('stays at the base interval when the list keeps changing', () => {
    expect(computeNextIntervalMs(base, 0, false)).toBe(base)
  })

  it('stretches the interval as consecutive polls come back with no changes', () => {
    const first = computeNextIntervalMs(base, 1, false)
    const second = computeNextIntervalMs(base, 3, false)
    const capped = computeNextIntervalMs(base, 999, false)
    expect(first).toBeGreaterThan(base)
    expect(second).toBeGreaterThan(first)
    // Never grow past the last step of the backoff schedule.
    expect(capped).toBe(base * IDLE_BACKOFF_STEPS[IDLE_BACKOFF_STEPS.length - 1])
  })

  it('drops to a slow heartbeat when the tab is hidden', () => {
    expect(computeNextIntervalMs(base, 0, true)).toBe(HIDDEN_INTERVAL_MS)
    expect(computeNextIntervalMs(base, 999, true)).toBe(HIDDEN_INTERVAL_MS)
  })
})

describe('computeErrorIntervalMs — back off when polls keep failing', () => {
  const base = 5000

  it('returns the base interval with zero errors', () => {
    expect(computeErrorIntervalMs(base, 0)).toBe(base)
  })

  it('keeps the same pace after the first error (1× — single blips should not slow things down)', () => {
    expect(computeErrorIntervalMs(base, 1)).toBe(base)
  })

  it('doubles after the second consecutive error', () => {
    expect(computeErrorIntervalMs(base, 2)).toBe(base * 2)
  })

  it('grows exponentially with each additional failure', () => {
    const second = computeErrorIntervalMs(base, 2)
    const third = computeErrorIntervalMs(base, 3)
    const fourth = computeErrorIntervalMs(base, 4)
    expect(third).toBeGreaterThan(second)
    expect(fourth).toBeGreaterThan(third)
  })

  it('is capped at ERROR_BACKOFF_CAP_MS regardless of error count', () => {
    expect(computeErrorIntervalMs(base, 999)).toBe(ERROR_BACKOFF_CAP_MS)
  })
})
