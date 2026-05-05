import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, getSessionToken } from '../utils/api'

interface ProfileSettings {
  login: string
  hidden: boolean
}

let cachedSettings: ProfileSettings | null = null
let fetchPromise: Promise<ProfileSettings> | null = null
const listeners = new Set<(s: ProfileSettings | null) => void>()

function notify() {
  for (const listener of listeners) listener(cachedSettings)
}

function loadSettings(): Promise<ProfileSettings> {
  if (!fetchPromise) {
    fetchPromise = apiGet<ProfileSettings>('profile-settings').then(resp => {
      cachedSettings = resp
      notify()
      return resp
    })
  }
  return fetchPromise
}

export function useProfileVisibility() {
  const [settings, setSettings] = useState<ProfileSettings | null>(cachedSettings)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listeners.add(setSettings)
    if (getSessionToken()) {
      if (cachedSettings) {
        setSettings(cachedSettings)
      } else {
        loadSettings().catch(() => { /* ignore */ })
      }
    }
    return () => {
      listeners.delete(setSettings)
    }
  }, [])

  const setHidden = useCallback(async (hidden: boolean) => {
    setSaving(true)
    try {
      await apiPost<{ hidden: boolean }>('profile-visibility', { hidden })
      if (cachedSettings) {
        cachedSettings = { ...cachedSettings, hidden }
        notify()
      }
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, saving, setHidden }
}
