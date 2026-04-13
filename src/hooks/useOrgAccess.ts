import { useState, useCallback } from 'react'

export interface OrgAccessInfo {
  login: string
  avatar_url: string
  role: 'admin' | 'member'
  accessible: boolean
}

export interface OrgAccessResult {
  memberOrgs: OrgAccessInfo[]
  visibleOrgs: string[]
  restrictedOrgs: string[]
  oauthScopes: string | null
  loading: boolean
}

export function useOrgAccess() {
  const [result, setResult] = useState<OrgAccessResult>({
    memberOrgs: [],
    visibleOrgs: [],
    restrictedOrgs: [],
    oauthScopes: null,
    loading: false,
  })

  const checkOrgAccess = useCallback(async (visibleOrgNames: string[]) => {
    const token = localStorage.getItem('github_access_token')
    if (!token) return

    setResult(prev => ({ ...prev, loading: true }))

    try {
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      }

      const membershipsResponse = await fetch(
        'https://api.github.com/user/memberships/orgs?state=active&per_page=100',
        { headers }
      )

      const rawScopes = membershipsResponse.headers.get('X-OAuth-Scopes')
      const oauthScopes = rawScopes?.trim() || null

      if (!membershipsResponse.ok) {
        setResult(prev => ({
          ...prev,
          oauthScopes,
          loading: false,
        }))
        return
      }

      const memberships: Array<{
        role: 'admin' | 'member'
        organization: { login: string; avatar_url: string }
      }> = await membershipsResponse.json()

      const accessChecks = await Promise.all(
        memberships.map(async (m): Promise<OrgAccessInfo> => {
          try {
            const resp = await fetch(
              `https://api.github.com/orgs/${m.organization.login}/repos?per_page=1&type=private`,
              { headers }
            )
            return {
              login: m.organization.login,
              avatar_url: m.organization.avatar_url,
              role: m.role,
              accessible: resp.ok,
            }
          } catch {
            return {
              login: m.organization.login,
              avatar_url: m.organization.avatar_url,
              role: m.role,
              accessible: false,
            }
          }
        })
      )

      const restricted = accessChecks
        .filter(o => !o.accessible && !visibleOrgNames.includes(o.login))
        .map(o => o.login)

      setResult({
        memberOrgs: accessChecks,
        visibleOrgs: visibleOrgNames,
        restrictedOrgs: restricted,
        oauthScopes,
        loading: false,
      })
    } catch {
      setResult(prev => ({ ...prev, loading: false }))
    }
  }, [])

  return { orgAccess: result, checkOrgAccess }
}
