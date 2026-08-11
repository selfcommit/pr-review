import { useState, useCallback, useEffect } from 'react'
import { requestNotificationPermission } from '../utils/browserNotification'
import { apiGet, apiPost, getSessionToken } from '../utils/api'

const SOUND_KEY = 'notification-sound-enabled'
const DESKTOP_KEY = 'notification-desktop-enabled'

function readBool(key: string): boolean {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return true
    return stored === 'true'
  } catch {
    return true
  }
}

function writeLocal(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // storage unavailable
  }
}

interface AudioStateResponse {
  sound_enabled: boolean | null
  desktop_notifications_enabled: boolean | null
}

export function useNotificationPreference() {
  const [soundEnabled, setSoundEnabledState] = useState(() => readBool(SOUND_KEY))
  const [desktopEnabled, setDesktopEnabledState] = useState(() => readBool(DESKTOP_KEY))

  useEffect(() => {
    if (soundEnabled || desktopEnabled) {
      requestNotificationPermission()
    }
    if (!getSessionToken()) return
    let cancelled = false
    apiGet<AudioStateResponse>('audio-state')
      .then(state => {
        if (cancelled || !state) return
        if (typeof state.sound_enabled === 'boolean') {
          setSoundEnabledState(state.sound_enabled)
          writeLocal(SOUND_KEY, state.sound_enabled)
        }
        if (typeof state.desktop_notifications_enabled === 'boolean') {
          setDesktopEnabledState(state.desktop_notifications_enabled)
          writeLocal(DESKTOP_KEY, state.desktop_notifications_enabled)
        }
        if (state.sound_enabled || state.desktop_notifications_enabled) {
          requestNotificationPermission()
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const setSoundEnabled = useCallback((value: boolean) => {
    setSoundEnabledState(value)
    writeLocal(SOUND_KEY, value)
    if (value) requestNotificationPermission()
    if (getSessionToken()) {
      apiPost('audio-state', { sound_enabled: value }).catch(() => {})
    }
  }, [])

  const setDesktopEnabled = useCallback((value: boolean) => {
    setDesktopEnabledState(value)
    writeLocal(DESKTOP_KEY, value)
    if (value) requestNotificationPermission()
    if (getSessionToken()) {
      apiPost('audio-state', { desktop_notifications_enabled: value }).catch(() => {})
    }
  }, [])

  return { soundEnabled, setSoundEnabled, desktopEnabled, setDesktopEnabled }
}
