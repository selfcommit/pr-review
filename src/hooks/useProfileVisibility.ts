import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost, getSessionToken } from '../utils/api'

interface ProfileSettings {
  login: string
  hidden: boolean
}

export function useProfileVisibility() {
  const [settings, setSettings] = useState<ProfileSettings | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!getSessionToken()) return
    let cancelled = false
    apiGet<ProfileSettings>('profile-settings')
      .then(resp => {
        if (!cancelled) setSettings(resp)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const setHidden = useCallback(async (hidden: boolean) => {
    setSaving(true)
    try {
      await apiPost<{ hidden: boolean }>('profile-visibility', { hidden })
      setSettings(prev => (prev ? { ...prev, hidden } : prev))
    } finally {
      setSaving(false)
    }
  }, [])

  return { settings, saving, setHidden }
}
