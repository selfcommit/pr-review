import { useState, useCallback } from 'react'
import { apiGet, apiPost } from '../utils/api'

export interface OrgAccessInfo {
  login: string
  avatar_url: string
  role: 'admin' | 'member'
  excluded: boolean
}

export interface OrgAccessResult {
  memberOrgs: OrgAccessInfo[]
  loading: boolean
  error: string | null
  oauthScopes: string | null
}

interface OrgApiResponse {
  orgs: Array<{
    org_login: string
    org_avatar_url: string | null
    role: string
    excluded?: boolean
  }>
  oauthScopes: string | null
}

export function useOrgAccess() {
  const [result, setResult] = useState<OrgAccessResult>({
    memberOrgs: [],
    loading: false,
    error: null,
    oauthScopes: null,
  })

  const fetchOrgs = useCallback(async (refresh = false) => {
    setResult(prev => ({ ...prev, loading: true, error: null }))

    try {
      const path = refresh ? 'orgs?refresh=true' : 'orgs'
      const data = await apiGet<OrgApiResponse>(path)

      const orgs = Array.isArray(data.orgs) ? data.orgs : []
      const memberOrgs: OrgAccessInfo[] = orgs.map(org => ({
        login: org.org_login,
        avatar_url: org.org_avatar_url || `https://github.com/${org.org_login}.png?size=80`,
        role: org.role === 'admin' ? 'admin' : 'member',
        excluded: org.excluded === true,
      }))

      setResult({
        memberOrgs,
        loading: false,
        error: null,
        oauthScopes: data.oauthScopes || null,
      })
    } catch (err) {
      setResult(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch organizations',
      }))
    }
  }, [])

  const toggleOrgExclusion = useCallback(async (orgLogin: string, excluded: boolean) => {
    setResult(prev => ({
      ...prev,
      memberOrgs: prev.memberOrgs.map(org =>
        org.login === orgLogin ? { ...org, excluded } : org
      ),
    }))

    try {
      await apiPost('org-exclusion', { org_login: orgLogin, excluded })
    } catch {
      setResult(prev => ({
        ...prev,
        memberOrgs: prev.memberOrgs.map(org =>
          org.login === orgLogin ? { ...org, excluded: !excluded } : org
        ),
      }))
    }
  }, [])

  return { orgAccess: result, fetchOrgs, toggleOrgExclusion }
}
