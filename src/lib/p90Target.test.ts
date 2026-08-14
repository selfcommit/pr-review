import { describe, it, expect } from 'vitest'
import { reviewsNeededToBringP90Under } from './p90Target'

const H = 3600
const UNDER = 5 * H
const OVER = 30 * H

describe('reviewsNeededToBringP90Under', () => {
  it('returns null when there are no timed reviews', () => {
    expect(reviewsNeededToBringP90Under([])).toBeNull()
    expect(reviewsNeededToBringP90Under([null, null])).toBeNull()
  })

  it('returns 0 when P90 is already under 24 hours', () => {
    const latencies = [UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, OVER]
    expect(reviewsNeededToBringP90Under(latencies)).toBe(0)
  })

  it('returns 0 when every review is under target', () => {
    expect(reviewsNeededToBringP90Under([UNDER, UNDER, UNDER])).toBe(0)
  })

  it('returns a positive count when P90 is over 24 hours', () => {
    const latencies = [UNDER, UNDER, UNDER, UNDER, UNDER, OVER, OVER, OVER, OVER, OVER]
    expect(reviewsNeededToBringP90Under(latencies)).toBe(40)
  })

  it('rounds up so the new ratio truly reaches 90%', () => {
    const latencies = [UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, UNDER, OVER, OVER]
    const needed = reviewsNeededToBringP90Under(latencies)
    expect(needed).toBe(10)
    const N = 10 + (needed as number)
    const K = 8 + (needed as number)
    expect(K / N).toBeGreaterThanOrEqual(0.9)
  })

  it('handles a sample with only over-target reviews', () => {
    expect(reviewsNeededToBringP90Under([OVER, OVER, OVER])).toBe(27)
  })

  it('ignores null latencies when computing the ratio', () => {
    const latencies = [UNDER, UNDER, OVER, null, null]
    expect(reviewsNeededToBringP90Under(latencies)).toBe(7)
  })
})
