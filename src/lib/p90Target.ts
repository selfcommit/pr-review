const ON_TARGET_SECONDS = 24 * 3600

export function reviewsNeededToBringP90Under(
  latencies: (number | null)[],
  thresholdSeconds: number = ON_TARGET_SECONDS,
): number | null {
  const timed = latencies.filter((v): v is number => v !== null)
  if (timed.length === 0) return null
  const N = timed.length
  const K = timed.filter(v => v <= thresholdSeconds).length
  const needed = 9 * N - 10 * K
  return needed <= 0 ? 0 : Math.ceil(needed)
}
