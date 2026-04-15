import { useState, useCallback } from 'react'

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

  const setSoundEnabled = useCallback((value: boolean) => {
    setSoundEnabledState(value)
    try {
      localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // storage unavailable
    }
  }, [])

  return { soundEnabled, setSoundEnabled }
}
