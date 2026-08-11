import { useEffect, useRef, useCallback, useState } from 'react'
import { App } from '@capacitor/app'
import { apiGet } from '../utils/api'
import { isNativeApp } from '../utils/platform'

interface PollResult {
  changed: boolean
  updatedPRs: Array<Record<string, unknown>>
  removedPRIds: number[]
  removalReasons: Record<number, string>
  newPRs: Array<Record<string, unknown>>
  reviewTimestamps: Record<number, string>
  visibleIds?: number[]
  rateLimitRemaining: string | null
  rateLimitReset: string | null
}

interface UsePollingOptions {
  enabled: boolean
  intervalMs?: number
  fullCheckEveryN?: number
  onChanges: (result: PollResult) => void | Promise<void>
  onResume?: () => void
}

// Fallback when GitHub reports a rate-limit reset time that is missing or
// already in the past — we still want to try again before the tab goes stale.
export const PAUSE_FALLBACK_MS = 30_000

// Regression: your session hit "remaining=30" with a reset time already in
// the past. The old code did `resetMs = reset*1000 - now + 5000`; if the
// result was <= 0 it silently skipped scheduling the unpause, leaving the
// client paused until a full page refresh. This helper is the single source
// of truth for "given the rate-limit headers, how long should we pause?".
export function computePauseDelayMs(
  rateLimitRemaining: string | null,
  rateLimitReset: string | null,
  now: number = Date.now(),
): number | null {
  if (!rateLimitRemaining) return null
  const remaining = parseInt(rateLimitRemaining, 10)
  if (Number.isNaN(remaining) || remaining >= 50) return null
  const resetSec = rateLimitReset ? parseInt(rateLimitReset, 10) : NaN
  if (!Number.isFinite(resetSec)) return PAUSE_FALLBACK_MS
  const resetMs = resetSec * 1000 - now + 5000
  if (resetMs <= 0) return PAUSE_FALLBACK_MS
  return resetMs
}

export interface PollingStatus {
  paused: boolean
  resumeAt: number | null
}

export function usePolling({
  enabled,
  intervalMs = 60000,
  fullCheckEveryN = 6,
  onChanges,
  onResume,
}: UsePollingOptions) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)
  const resumeAtRef = useRef<number | null>(null)
  const consecutiveErrorsRef = useRef(0)
  const effectiveIntervalRef = useRef(intervalMs)
  const onChangesRef = useRef(onChanges)
  onChangesRef.current = onChanges
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume
  const pollCountRef = useRef(0)
  const pollRef = useRef<(() => Promise<void>) | null>(null)

  const [status, setStatus] = useState<PollingStatus>({ paused: false, resumeAt: null })

  const startIntervalRef = useRef<(() => void) | null>(null)

  const clearPauseTimeout = useCallback(() => {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }
  }, [])

  const resumeFromPause = useCallback(() => {
    clearPauseTimeout()
    if (!pausedRef.current) return
    pausedRef.current = false
    resumeAtRef.current = null
    setStatus({ paused: false, resumeAt: null })
    onResumeRef.current?.()
    // Fire an immediate poll so tiles catch up instantly rather than waiting
    // a full interval — the whole reason the pause existed was that tiles
    // were behind reality.
    void pollRef.current?.()
  }, [clearPauseTimeout])

  const scheduleResume = useCallback(
    (delayMs: number) => {
      clearPauseTimeout()
      const safeDelay = Math.max(0, delayMs)
      resumeAtRef.current = Date.now() + safeDelay
      setStatus({ paused: true, resumeAt: resumeAtRef.current })
      pauseTimeoutRef.current = setTimeout(() => {
        pauseTimeoutRef.current = null
        resumeFromPause()
      }, safeDelay)
    },
    [clearPauseTimeout, resumeFromPause],
  )

  const poll = useCallback(async () => {
    if (pausedRef.current) return
    try {
      pollCountRef.current += 1
      const doFullCheck = pollCountRef.current % fullCheckEveryN === 0
      const endpoint = doFullCheck ? 'poll-reviews?check_all=true' : 'poll-reviews'
      const result = await apiGet<PollResult>(endpoint)
      consecutiveErrorsRef.current = 0

      const pauseDelay = computePauseDelayMs(result.rateLimitRemaining, result.rateLimitReset)
      if (pauseDelay !== null) {
        pausedRef.current = true
        scheduleResume(pauseDelay)
        return
      }
      if (result.rateLimitRemaining) {
        const remaining = parseInt(result.rateLimitRemaining, 10)
        const prevInterval = effectiveIntervalRef.current
        if (!Number.isNaN(remaining) && remaining < 100) {
          effectiveIntervalRef.current = intervalMs * 2
        } else {
          effectiveIntervalRef.current = intervalMs
        }
        if (effectiveIntervalRef.current !== prevInterval && startIntervalRef.current) {
          startIntervalRef.current()
        }
      }

      const hasVisibleIds = Array.isArray(result.visibleIds)
      if (result.changed || (result.removedPRIds && result.removedPRIds.length > 0) || hasVisibleIds) {
        try {
          await onChangesRef.current(result)
        } catch (err) {
          console.error('[usePolling] onChanges handler threw:', err)
        }
      }
    } catch (err) {
      // Never let a transient failure permanently pause the client — the whole
      // point of polling is that the next tick tries again.
      consecutiveErrorsRef.current += 1
      if (consecutiveErrorsRef.current === 1) {
        console.warn('[usePolling] poll failed, will retry:', err)
      }
    }
  }, [intervalMs, fullCheckEveryN, scheduleResume])

  pollRef.current = poll

  const pause = useCallback(() => {
    pausedRef.current = true
    clearPauseTimeout()
    resumeAtRef.current = null
    setStatus({ paused: true, resumeAt: null })
  }, [clearPauseTimeout])
  const resume = useCallback(() => {
    clearPauseTimeout()
    pausedRef.current = false
    resumeAtRef.current = null
    setStatus({ paused: false, resumeAt: null })
  }, [clearPauseTimeout])

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
        // Safety net: if we ever miss the scheduled unpause (tab was sleeping,
        // setTimeout got dropped), the interval tick will notice and recover.
        if (pausedRef.current && resumeAtRef.current !== null && Date.now() >= resumeAtRef.current) {
          resumeFromPause()
          return
        }
        poll()
      }, effectiveIntervalRef.current)
    }

    startIntervalRef.current = startInterval
    startInterval()

    const handleVisibility = () => {
      if (!document.hidden) {
        // Coming back to the tab — if we were paused past the reset, recover
        // now instead of waiting for the next interval to notice.
        if (pausedRef.current && resumeAtRef.current !== null && Date.now() >= resumeAtRef.current) {
          resumeFromPause()
        } else {
          poll()
        }
      }
      startInterval()
    }

    document.addEventListener('visibilitychange', handleVisibility)

    let removeNativeListener: (() => void) | null = null
    if (isNativeApp()) {
      const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          pausedRef.current = false
          resumeAtRef.current = null
          setStatus({ paused: false, resumeAt: null })
          poll()
          startInterval()
        } else {
          pausedRef.current = true
          if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
          }
        }
      })
      removeNativeListener = () => {
        listenerPromise.then(h => h.remove())
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      clearPauseTimeout()
      startIntervalRef.current = null
      document.removeEventListener('visibilitychange', handleVisibility)
      if (removeNativeListener) removeNativeListener()
    }
  }, [enabled, poll, resumeFromPause, clearPauseTimeout])

  return { pause, resume, status }
}
