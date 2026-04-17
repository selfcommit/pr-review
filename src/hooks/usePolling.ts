import { useEffect, useRef, useCallback } from 'react'
import { apiGet } from '../utils/api'

interface PollResult {
  changed: boolean
  updatedPRs: Array<Record<string, unknown>>
  removedPRIds: number[]
  newPRs: Array<Record<string, unknown>>
  reviewTimestamps: Record<number, string>
  rateLimitRemaining: string | null
  rateLimitReset: string | null
}

interface UsePollingOptions {
  enabled: boolean
  intervalMs?: number
  onChanges: (result: PollResult) => void
}

export function usePolling({ enabled, intervalMs = 60000, onChanges }: UsePollingOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pausedRef = useRef(false)
  const effectiveIntervalRef = useRef(intervalMs)
  const onChangesRef = useRef(onChanges)
  onChangesRef.current = onChanges

  const poll = useCallback(async () => {
    if (pausedRef.current) return
    try {
      const result = await apiGet<PollResult>('poll-reviews')

      if (result.rateLimitRemaining) {
        const remaining = parseInt(result.rateLimitRemaining, 10)
        if (remaining < 50) {
          pausedRef.current = true
          if (result.rateLimitReset) {
            const resetMs = parseInt(result.rateLimitReset, 10) * 1000 - Date.now() + 5000
            if (resetMs > 0) {
              setTimeout(() => { pausedRef.current = false }, resetMs)
            }
          }
          return
        }
        if (remaining < 100) {
          effectiveIntervalRef.current = intervalMs * 2
        } else {
          effectiveIntervalRef.current = intervalMs
        }
      }

      if (result.changed) {
        onChangesRef.current(result)
      }
    } catch {
      // silently ignore poll failures
    }
  }, [intervalMs])

  const pause = useCallback(() => { pausedRef.current = true }, [])
  const resume = useCallback(() => { pausedRef.current = false }, [])

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      return
    }

    const startInterval = () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        poll()
      }, effectiveIntervalRef.current)
    }

    startInterval()

    const handleVisibility = () => {
      if (!document.hidden) {
        poll()
      }
      startInterval()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [enabled, poll])

  return { pause, resume }
}
