import { describe, it, expect } from 'vitest'
import { shouldFireReadinessChime } from './readinessChime'

// Guard rails for the load-time chime the dashboard plays so audio is warmed
// up before the first real review-request notification. Regression coverage
// for the report that sound only worked after the user toggled Notification
// Sound off and back on.
describe('shouldFireReadinessChime', () => {
  it('fires once when the dashboard is ready and sound is on', () => {
    expect(
      shouldFireReadinessChime({ initialLoadComplete: true, soundEnabled: true, alreadyFired: false }),
    ).toBe(true)
  })

  it('never fires while the dashboard is still loading', () => {
    expect(
      shouldFireReadinessChime({ initialLoadComplete: false, soundEnabled: true, alreadyFired: false }),
    ).toBe(false)
  })

  it('stays silent when the user has turned Notification Sound off', () => {
    expect(
      shouldFireReadinessChime({ initialLoadComplete: true, soundEnabled: false, alreadyFired: false }),
    ).toBe(false)
  })

  it('does not fire a second time after the readiness chime has already played', () => {
    expect(
      shouldFireReadinessChime({ initialLoadComplete: true, soundEnabled: true, alreadyFired: true }),
    ).toBe(false)
  })

  it('stays silent for returning users whose saved preference is off', () => {
    expect(
      shouldFireReadinessChime({ initialLoadComplete: true, soundEnabled: false, alreadyFired: false }),
    ).toBe(false)
  })

  it('remains armed if the initial play was blocked (alreadyFired still false)', () => {
    // The dashboard keeps `alreadyFired` false when the browser blocks the
    // autoplay attempt; the retry on first interaction is expected to succeed.
    expect(
      shouldFireReadinessChime({ initialLoadComplete: true, soundEnabled: true, alreadyFired: false }),
    ).toBe(true)
  })
})
