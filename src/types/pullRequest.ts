export interface PullRequest {
  id: number
  title: string
  html_url: string
  created_at: string
  updated_at: string
  state: string
  pull_request_merged: boolean
  repository: {
    name: string
    full_name: string
    html_url: string
  }
  user: {
    login: string
    avatar_url: string
  }
  draft: boolean
  review_requested_at?: string
}

export interface OrgPRs {
  org: string
  pullRequests: PullRequest[]
}

export function mapItem(item: Record<string, unknown>): PullRequest {
  const repoUrl = (item.repository_url as string) || ''
  const htmlUrl = (item.html_url as string) || ''
  const itemUser = (item.user as { login: string; avatar_url: string }) || { login: 'unknown', avatar_url: '' }
  const pr = item.pull_request as { merged_at?: string } | undefined
  return {
    id: item.id as number,
    title: (item.title as string) || '',
    html_url: htmlUrl,
    created_at: (item.created_at as string) || '',
    updated_at: (item.updated_at as string) || '',
    state: (item.state as string) || 'open',
    pull_request_merged: pr?.merged_at != null,
    repository: {
      name: repoUrl.split('/').pop() || '',
      full_name: repoUrl.split('/').slice(-2).join('/'),
      html_url: htmlUrl.split('/pull/')[0],
    },
    user: {
      login: itemUser.login || 'unknown',
      avatar_url: itemUser.avatar_url || '',
    },
    draft: (item.draft as boolean) || false,
  }
}

export function groupByOrg(prs: PullRequest[]): OrgPRs[] {
  const grouped = prs.reduce((acc, pr) => {
    const org = pr.repository.full_name.split('/')[0]
    const existing = acc.find(g => g.org === org)
    if (existing) {
      existing.pullRequests.push(pr)
    } else {
      acc.push({ org, pullRequests: [pr] })
    }
    return acc
  }, [] as OrgPRs[])
  grouped.sort((a, b) => a.org.localeCompare(b.org))
  grouped.forEach(g => {
    g.pullRequests.sort((a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )
  })
  return grouped
}
