import { useState, useCallback, useEffect } from 'react'
import { requestNotificationPermission } from '../utils/browserNotification'

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

export function useNotificationPreference() {
  const [soundEnabled, setSoundEnabledState] = useState(readPreference)

  useEffect(() => {
    if (soundEnabled) {
      requestNotificationPermission()
    }
  }, [])

  const setSoundEnabled = useCallback((value: boolean) => {
    setSoundEnabledState(value)
    try {
      localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // storage unavailable
    }
    if (value) {
      requestNotificationPermission()
    }
  }, [])

  return { soundEnabled, setSoundEnabled }
}
