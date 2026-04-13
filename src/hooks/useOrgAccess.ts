import { useState, useCallback } from 'react'
import { apiGet } from '../utils/api'

export interface OrgAccessInfo {
  login: string
  avatar_url: string
  role: 'admin' | 'member'
  accessible: boolean
}

export interface OrgAccessResult {
  memberOrgs: OrgAccessInfo[]
  restrictedOrgs: string[]
  loading: boolean
}

interface OrgApiResponse {
  orgs: Array<{
    org_login: string
    org_avatar_url: string | null
    role: string
    accessible: boolean
  }>
}

export function useOrgAccess() {
  const [result, setResult] = useState<OrgAccessResult>({
    memberOrgs: [],
    restrictedOrgs: [],
    loading: false,
  })

  const fetchOrgs = useCallback(async (refresh = false) => {
    setResult(prev => ({ ...prev, loading: true }))

    try {
      const path = refresh ? 'orgs?refresh=true' : 'orgs'
      const data = await apiGet<OrgApiResponse>(path)

      const memberOrgs: OrgAccessInfo[] = data.orgs.map(org => ({
        login: org.org_login,
        avatar_url: org.org_avatar_url || `https://github.com/${org.org_login}.png?size=80`,
        role: org.role === 'admin' ? 'admin' : 'member',
        accessible: org.accessible,
      }))

      const restrictedOrgs = memberOrgs
        .filter(o => !o.accessible)
        .map(o => o.login)

      setResult({
        memberOrgs,
        restrictedOrgs,
        loading: false,
      })
    } catch {
      setResult(prev => ({ ...prev, loading: false }))
    }
  }, [])

  return { orgAccess: result, fetchOrgs }
}
