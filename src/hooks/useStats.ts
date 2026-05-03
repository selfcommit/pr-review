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

async function fetchStats(force = false): Promise<StatsResponse> {
  if (inFlight) return inFlight
  const path = force ? 'stats?force=true' : 'stats'
  inFlight = apiGet<StatsResponse>(path)
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

  const load = useCallback(async (force: boolean) => {
    try {
      setRefreshing(true)
      setError(null)
      await fetchStats(force)
    } catch (err) {
      if (err instanceof Error && err.message === 'Session expired') return
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const refresh = useCallback(() => load(true), [load])

  useEffect(() => {
    const listener: Listener = next => setData(next)
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  useEffect(() => {
    load(false)
  }, [load])

  return { data, refreshing, error, refresh }
}
