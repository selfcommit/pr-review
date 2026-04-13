import { useState, useCallback } from 'react'

export interface OrgAccessInfo {
  login: string
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

      const orgsResponse = await fetch(
        'https://api.github.com/user/orgs?per_page=100',
        { headers }
      )

      const oauthScopes = orgsResponse.headers.get('X-OAuth-Scopes')

      if (!orgsResponse.ok) {
        setResult(prev => ({
          ...prev,
          oauthScopes,
          loading: false,
        }))
        return
      }

      const orgs: Array<{ login: string }> = await orgsResponse.json()
      const memberOrgNames = orgs.map(o => o.login)

      const accessChecks = await Promise.all(
        memberOrgNames.map(async (orgLogin): Promise<OrgAccessInfo> => {
          try {
            const resp = await fetch(
              `https://api.github.com/orgs/${orgLogin}/repos?per_page=1`,
              { headers }
            )
            return { login: orgLogin, accessible: resp.ok }
          } catch {
            return { login: orgLogin, accessible: false }
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
