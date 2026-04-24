import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '../utils/api'
import { StatsResponse } from '../types/stats'

const CACHE_KEY = 'stats_cache'

type Listener = (data: StatsResponse | null) => void

let inFlight: Promise<StatsResponse> | null = null
let current: StatsResponse | null = null
const listeners = new Set<Listener>()

function readCache(): StatsResponse | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StatsResponse
  } catch {
    return null
  }
}

function writeCache(data: StatsResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    /* quota exceeded is fine */
  }
}

function broadcast() {
  for (const l of listeners) l(current)
}

async function fetchStats(): Promise<StatsResponse> {
  if (inFlight) return inFlight
  inFlight = apiGet<StatsResponse>('stats')
    .then(resp => {
      current = resp
      writeCache(resp)
      broadcast()
      return resp
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function useStats() {
  if (current === null) {
    current = readCache()
  }

  const [data, setData] = useState<StatsResponse | null>(current)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true)
      setError(null)
      await fetchStats()
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const listener: Listener = next => setData(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, refreshing, error, refresh }
}
