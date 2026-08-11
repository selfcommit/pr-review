import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { formatWaitTime, isOverdue, getUrgencyLevel } from './time'

describe('formatWaitTime', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ticks from "1m" to "2m" without a network call', () => {
    const t0 = new Date('2026-06-01T12:00:00Z')
    vi.setSystemTime(t0)
    const requestedAt = new Date(t0.getTime() - 60 * 1000).toISOString()
    expect(formatWaitTime(requestedAt)).toBe('1m')
    vi.setSystemTime(new Date(t0.getTime() + 60 * 1000))
    expect(formatWaitTime(requestedAt)).toBe('2m')
  })

  it('rolls up to hours, days, and weeks', () => {
    const t0 = new Date('2026-06-01T12:00:00Z')
    vi.setSystemTime(t0)
    expect(formatWaitTime(new Date(t0.getTime() - 2 * 60 * 60 * 1000).toISOString())).toBe('2h')
    expect(formatWaitTime(new Date(t0.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString())).toBe('3d')
    expect(formatWaitTime(new Date(t0.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString())).toBe('2w')
  })
})

describe('overdue detection', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('marks anything 24h+ old as overdue', () => {
    const t0 = new Date('2026-06-01T12:00:00Z')
    vi.setSystemTime(t0)
    expect(isOverdue(new Date(t0.getTime() - 23 * 60 * 60 * 1000).toISOString())).toBe(false)
    expect(isOverdue(new Date(t0.getTime() - 25 * 60 * 60 * 1000).toISOString())).toBe(true)
  })

  it('assigns urgency by age', () => {
    const t0 = new Date('2026-06-01T12:00:00Z')
    vi.setSystemTime(t0)
    expect(getUrgencyLevel(new Date(t0.getTime() - 60 * 1000).toISOString())).toBe('green')
    expect(getUrgencyLevel(new Date(t0.getTime() - 15 * 60 * 60 * 1000).toISOString())).toBe('amber')
    expect(getUrgencyLevel(new Date(t0.getTime() - 30 * 60 * 60 * 1000).toISOString())).toBe('red')
  })
})
