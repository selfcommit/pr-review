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

      const orgsResponse = await fetch(
        'https://api.github.com/user/orgs?per_page=100',
        { headers }
      )

      const rawScopes = orgsResponse.headers.get('X-OAuth-Scopes')
      const oauthScopes = rawScopes?.trim() || null

      const orgMap = new Map<string, OrgAccessInfo>()

      if (orgsResponse.ok) {
        const orgs: Array<{ login: string; avatar_url: string }> = await orgsResponse.json()
        for (const org of orgs) {
          orgMap.set(org.login.toLowerCase(), {
            login: org.login,
            avatar_url: org.avatar_url,
            role: 'member',
            accessible: false,
          })
        }
      }

      for (const name of visibleOrgNames) {
        const key = name.toLowerCase()
        if (!orgMap.has(key)) {
          orgMap.set(key, {
            login: name,
            avatar_url: `https://github.com/${name}.png?size=80`,
            role: 'member',
            accessible: true,
          })
        }
      }

      const accessChecks = await Promise.all(
        Array.from(orgMap.values()).map(async (org): Promise<OrgAccessInfo> => {
          if (visibleOrgNames.some(v => v.toLowerCase() === org.login.toLowerCase())) {
            return { ...org, accessible: true }
          }
          try {
            const resp = await fetch(
              `https://api.github.com/orgs/${org.login}/repos?per_page=1&type=private`,
              { headers }
            )
            return { ...org, accessible: resp.ok }
          } catch {
            return { ...org, accessible: false }
          }
        })
      )

      const restricted = accessChecks
        .filter(o => !o.accessible)
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
