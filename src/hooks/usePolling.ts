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

// GitHub's Search API allows only 30 requests per minute per authenticated
// user, so the pause threshold has to sit well below 30 or every response
// would trip it — that was the reason "Paused" showed up in normal use.
export const RATE_LIMIT_PAUSE_THRESHOLD = 5

export function computePauseDelayMs(
  rateLimitRemaining: string | null,
  rateLimitReset: string | null,
  now: number = Date.now(),
): number | null {
  if (!rateLimitRemaining) return null
  const remaining = parseInt(rateLimitRemaining, 10)
  if (Number.isNaN(remaining) || remaining >= RATE_LIMIT_PAUSE_THRESHOLD) return null
  const resetSec = rateLimitReset ? parseInt(rateLimitReset, 10) : NaN
  if (!Number.isFinite(resetSec)) return PAUSE_FALLBACK_MS
  const resetMs = resetSec * 1000 - now + 5000
  if (resetMs <= 0) return PAUSE_FALLBACK_MS
  return resetMs
}

// Adaptive interval: when the last several polls returned nothing new, stretch
// the interval out. When something changes, snap back to the fast tempo so
// tiles still feel live. This is the primary lever for spending less of the
// tiny Search API budget on responses that do not change the UI.
export const IDLE_BACKOFF_STEPS = [1, 2, 4, 8, 12]
export const HIDDEN_INTERVAL_MS = 60_000

// Backoff multipliers for consecutive poll errors. The first error keeps the
// same tempo (1×) so a single blip doesn't slow anything down; subsequent
// failures double the interval up to a 5-minute ceiling.
export const ERROR_BACKOFF_STEPS = [1, 2, 4, 8, 16, 32, 64]
export const ERROR_BACKOFF_CAP_MS = 5 * 60_000

export function computeErrorIntervalMs(
  baseIntervalMs: number,
  consecutiveErrors: number,
): number {
  if (consecutiveErrors <= 0) return baseIntervalMs
  const stepIdx = Math.min(ERROR_BACKOFF_STEPS.length - 1, consecutiveErrors - 1)
  return Math.min(ERROR_BACKOFF_CAP_MS, baseIntervalMs * ERROR_BACKOFF_STEPS[stepIdx])
}

export function computeNextIntervalMs(
  baseIntervalMs: number,
  consecutiveIdlePolls: number,
  hidden: boolean,
): number {
  if (hidden) return HIDDEN_INTERVAL_MS
  const stepIdx = Math.min(IDLE_BACKOFF_STEPS.length - 1, consecutiveIdlePolls)
  return baseIntervalMs * IDLE_BACKOFF_STEPS[stepIdx]
}

function pollResultHadChange(result: PollResult): boolean {
  if (result.changed) return true
  if (result.removedPRIds && result.removedPRIds.length > 0) return true
  if (result.newPRs && result.newPRs.length > 0) return true
  if (result.updatedPRs && result.updatedPRs.length > 0) return true
  return false
}

export interface PollingStatus {
  paused: boolean
  resumeAt: number | null
  // True only when we're pausing because GitHub actually reported low budget,
  // not when the client is throttling itself between polls. The banner keys
  // off this so ordinary backoff never surfaces as "Paused".
  reason: 'rate-limit' | 'manual' | null
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
  const consecutiveIdleRef = useRef(0)
  const hiddenRef = useRef(typeof document !== 'undefined' && document.hidden)
  const onChangesRef = useRef(onChanges)
  onChangesRef.current = onChanges
  const onResumeRef = useRef(onResume)
  onResumeRef.current = onResume
  const pollCountRef = useRef(0)
  const pollRef = useRef<(() => Promise<void>) | null>(null)

  const [status, setStatus] = useState<PollingStatus>({ paused: false, resumeAt: null, reason: null })

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
    setStatus({ paused: false, resumeAt: null, reason: null })
    onResumeRef.current?.()
    void pollRef.current?.()
  }, [clearPauseTimeout])

  const scheduleResume = useCallback(
    (delayMs: number, reason: 'rate-limit' | 'manual') => {
      clearPauseTimeout()
      const safeDelay = Math.max(0, delayMs)
      resumeAtRef.current = Date.now() + safeDelay
      setStatus({ paused: true, resumeAt: resumeAtRef.current, reason })
      pauseTimeoutRef.current = setTimeout(() => {
        pauseTimeoutRef.current = null
        resumeFromPause()
      }, safeDelay)
    },
    [clearPauseTimeout, resumeFromPause],
  )

  const applyEffectiveInterval = useCallback(() => {
    const next = computeNextIntervalMs(intervalMs, consecutiveIdleRef.current, hiddenRef.current)
    if (next !== effectiveIntervalRef.current) {
      effectiveIntervalRef.current = next
      if (startIntervalRef.current) startIntervalRef.current()
    }
  }, [intervalMs])

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
        scheduleResume(pauseDelay, 'rate-limit')
        return
      }

      const hadChange = pollResultHadChange(result)
      consecutiveIdleRef.current = hadChange ? 0 : consecutiveIdleRef.current + 1
      applyEffectiveInterval()

      const hasVisibleIds = Array.isArray(result.visibleIds)
      if (result.changed || (result.removedPRIds && result.removedPRIds.length > 0) || hasVisibleIds) {
        try {
          await onChangesRef.current(result)
        } catch (err) {
          console.error('[usePolling] onChanges handler threw:', err)
        }
      }
    } catch (err) {
      consecutiveErrorsRef.current += 1
      if (consecutiveErrorsRef.current === 1) {
        console.warn('[usePolling] poll failed, will retry:', err)
      }
      // Stretch the retry interval exponentially so repeated failures don't
      // keep hammering the server at the normal fast cadence.
      const errorInterval = computeErrorIntervalMs(intervalMs, consecutiveErrorsRef.current)
      if (errorInterval !== effectiveIntervalRef.current) {
        effectiveIntervalRef.current = errorInterval
        if (startIntervalRef.current) startIntervalRef.current()
      }
    }
  }, [intervalMs, fullCheckEveryN, scheduleResume, applyEffectiveInterval])

  pollRef.current = poll

  const pause = useCallback(() => {
    pausedRef.current = true
    clearPauseTimeout()
    resumeAtRef.current = null
    setStatus({ paused: true, resumeAt: null, reason: 'manual' })
  }, [clearPauseTimeout])
  const resume = useCallback(() => {
    clearPauseTimeout()
    pausedRef.current = false
    resumeAtRef.current = null
    setStatus({ paused: false, resumeAt: null, reason: null })
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
        hiddenRef.current = false
        // Coming back after being hidden — reset the idle backoff so the
        // dashboard feels fresh again immediately.
        consecutiveIdleRef.current = 0
        applyEffectiveInterval()
        if (pausedRef.current && resumeAtRef.current !== null && Date.now() >= resumeAtRef.current) {
          resumeFromPause()
        } else {
          poll()
        }
      } else {
        hiddenRef.current = true
        applyEffectiveInterval()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)

    let removeNativeListener: (() => void) | null = null
    if (isNativeApp()) {
      const listenerPromise = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          pausedRef.current = false
          resumeAtRef.current = null
          setStatus({ paused: false, resumeAt: null, reason: null })
          hiddenRef.current = false
          consecutiveIdleRef.current = 0
          applyEffectiveInterval()
          poll()
          startInterval()
        } else {
          pausedRef.current = true
          hiddenRef.current = true
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
  }, [enabled, poll, resumeFromPause, clearPauseTimeout, applyEffectiveInterval])

  return { pause, resume, status }
}
