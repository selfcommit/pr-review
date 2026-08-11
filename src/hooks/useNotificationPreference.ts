import { useState, useCallback, useEffect } from 'react'
import { requestNotificationPermission } from '../utils/browserNotification'
import { apiGet, apiPost, getSessionToken } from '../utils/api'

const STORAGE_KEY = 'notification-sound-enabled'

function readPreference(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === null) return true
    return stored === 'true'
  } catch {
    return true
  }
}

function writeLocal(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // storage unavailable
  }
}

export function useNotificationPreference() {
  const [soundEnabled, setSoundEnabledState] = useState(readPreference)

  useEffect(() => {
    if (soundEnabled) {
      requestNotificationPermission()
    }
    // Returning users: if the server has a saved preference, prefer it over
    // whatever localStorage says so the setting really does persist across
    // devices and reinstalls.
    if (!getSessionToken()) return
    let cancelled = false
    apiGet<{ sound_enabled: boolean | null }>('audio-state')
      .then(state => {
        if (cancelled) return
        if (state && typeof state.sound_enabled === 'boolean') {
          setSoundEnabledState(state.sound_enabled)
          writeLocal(state.sound_enabled)
          if (state.sound_enabled) requestNotificationPermission()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const setSoundEnabled = useCallback((value: boolean) => {
    setSoundEnabledState(value)
    writeLocal(value)
    if (value) {
      requestNotificationPermission()
    }
    if (getSessionToken()) {
      apiPost('audio-state', { sound_enabled: value }).catch(() => {})
    }
  }, [])

  return { soundEnabled, setSoundEnabled }
}
