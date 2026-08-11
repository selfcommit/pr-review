#!/usr/bin/env node
// Post-deploy smoke check: verifies public sign-in and protected-route policies
// on the deployed github-auth edge function. Fails (exit 1) on any regression.

import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m) continue
    out[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
  return out
}

const envFile = readEnvFile(resolve(process.cwd(), '.env'))
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || envFile.VITE_SUPABASE_URL
if (!SUPABASE_URL) {
  console.error('SMOKE FAIL: VITE_SUPABASE_URL not configured')
  process.exit(1)
}

const base = `${SUPABASE_URL}/functions/v1/github-auth`
let failed = 0

async function check(name, fn) {
  try {
    await fn()
    console.log(`  ok  — ${name}`)
  } catch (err) {
    failed++
    console.error(`  FAIL — ${name}: ${err.message}`)
  }
}

await check('sign-in route is reachable without a login token', async () => {
  const res = await fetch(`${base}/login?redirect_to=https://pr-review.com`)
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`)
  const body = await res.json()
  if (!body.url || !body.state) throw new Error('response missing url/state')
  if (!body.url.startsWith('https://github.com/login/oauth/authorize')) {
    throw new Error('sign-in url does not point to GitHub OAuth')
  }
})

await check('protected route rejects requests without a session token', async () => {
  const res = await fetch(`${base}/pull-requests`)
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
  const body = await res.json().catch(() => ({}))
  if (!body.error) throw new Error('response missing error field')
})

await check('poll-reviews rejects requests without a session token', async () => {
  const res = await fetch(`${base}/poll-reviews`)
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
  const body = await res.json().catch(() => ({}))
  if (!body.error) throw new Error('response missing error field')
})

await check('poll-reviews rejects a bogus session token with 401', async () => {
  const res = await fetch(`${base}/poll-reviews`, {
    headers: { Authorization: 'Bearer smoke-check-bogus-session-token' },
  })
  if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
})

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY

async function supabaseAdmin(method, path, body) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured — cannot seed test user')
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return text ? JSON.parse(text) : null
}

function fakeSearchItem({ prId, prNumber, repo }) {
  const [owner, name] = repo.split('/')
  return {
    id: prId,
    number: prNumber,
    title: `Smoke PR ${prNumber}`,
    html_url: `https://github.com/${repo}/pull/${prNumber}`,
    created_at: '2026-08-11T12:00:00Z',
    updated_at: '2026-08-11T17:00:00Z',
    state: 'open',
    draft: false,
    pull_request: {},
    repository_url: `https://api.github.com/repos/${owner}/${name}`,
    user: { login: 'someone-else', avatar_url: '' },
  }
}

function fakeGraphqlResponse({ reviewState, viewerLogin, requestAt, reviewAt }) {
  return {
    data: {
      pr0: {
        pullRequest: {
          reviews: {
            nodes: [
              { author: { login: viewerLogin }, state: reviewState, submittedAt: reviewAt },
            ],
          },
          timelineItems: {
            nodes: [
              {
                createdAt: requestAt,
                requestedReviewer: { __typename: 'User', login: viewerLogin },
              },
            ],
          },
          comments: { nodes: [] },
        },
      },
    },
  }
}

async function runOperatorScenario({ label, reviewState, expectedReason }) {
  await check(label, async () => {
    const stamp = Date.now() + Math.floor(Math.random() * 1000)
    const syntheticGithubId = 900000000 + (stamp % 1000000)
    const login = `smoke-user-${stamp}`
    const prId = 8000000000 + (stamp % 1000000)
    const prNumber = 99000 + (stamp % 900)
    const repo = 'smoke-org/smoke-repo'

    const inserted = await supabaseAdmin('POST', 'app_users', {
      github_user_id: syntheticGithubId,
      login,
      name: 'Smoke Check User',
      avatar_url: '',
      access_token: 'smoke-check-bogus-github-token',
    })
    const sessionToken = inserted?.[0]?.session_token
    if (!sessionToken) throw new Error('failed to read back synthetic session token')

    await supabaseAdmin('POST', 'user_pr_snapshots', {
      github_user_id: syntheticGithubId,
      pr_id: prId,
      pr_number: prNumber,
      repo_full_name: repo,
      state: 'open',
      draft: false,
      title: `Smoke PR ${prNumber}`,
    })

    const fixture = {
      search: {
        items: [fakeSearchItem({ prId, prNumber, repo })],
        total_count: 1,
      },
      graphql: fakeGraphqlResponse({
        reviewState,
        viewerLogin: login,
        requestAt: '2026-08-11T12:00:00Z',
        reviewAt: '2026-08-11T17:00:00Z',
      }),
      rateLimitRemaining: '4900',
      rateLimitReset: `${Math.floor(Date.now() / 1000) + 3600}`,
    }

    try {
      const res = await fetch(`${base}/poll-reviews`, {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'X-PR-Review-Test-Fixture': Buffer.from(JSON.stringify(fixture)).toString('base64'),
          'X-PR-Review-Test-Auth': SUPABASE_SERVICE_ROLE_KEY,
        },
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`poll-reviews failed (${res.status}): ${errText.slice(0, 200)}`)
      }
      const body = await res.json()
      if (!Array.isArray(body.removedPRIds) || !body.removedPRIds.includes(prId)) {
        throw new Error(`expected removedPRIds to include ${prId}, got ${JSON.stringify(body.removedPRIds)}`)
      }
      if (body.removalReasons?.[prId] !== expectedReason) {
        throw new Error(
          `expected removalReasons[${prId}]=${expectedReason}, got ${JSON.stringify(body.removalReasons)}`,
        )
      }
      const reviewedRows = await supabaseAdmin(
        'GET',
        `poll_reviewed_prs?github_user_id=eq.${syntheticGithubId}&pr_id=eq.${prId}`,
      )
      if (!Array.isArray(reviewedRows) || reviewedRows.length === 0) {
        throw new Error('expected a row in poll_reviewed_prs for the fixture PR')
      }
      if (reviewedRows[0].review_state !== expectedReason) {
        throw new Error(
          `expected review_state=${expectedReason} in poll_reviewed_prs, got ${reviewedRows[0].review_state}`,
        )
      }
    } finally {
      await supabaseAdmin(
        'DELETE',
        `poll_reviewed_prs?github_user_id=eq.${syntheticGithubId}`,
      ).catch(() => {})
      await supabaseAdmin(
        'DELETE',
        `user_pr_snapshots?github_user_id=eq.${syntheticGithubId}`,
      ).catch(() => {})
      await supabaseAdmin(
        'DELETE',
        `app_users?github_user_id=eq.${syntheticGithubId}`,
      ).catch(() => {})
    }
  })
}

if (SUPABASE_SERVICE_ROLE_KEY) {
  await check('poll-reviews rejects a bogus test-fixture header without service-role auth', async () => {
    const res = await fetch(`${base}/poll-reviews`, {
      headers: {
        Authorization: 'Bearer smoke-check-bogus-session-token',
        'X-PR-Review-Test-Fixture': Buffer.from('{}').toString('base64'),
        'X-PR-Review-Test-Auth': 'not-the-service-role-key',
      },
    })
    if (res.status !== 401) throw new Error(`expected 401, got ${res.status}`)
  })

  await runOperatorScenario({
    label: 'poll-reviews removes the card the moment an approval is detected',
    reviewState: 'APPROVED',
    expectedReason: 'approved',
  })

  await runOperatorScenario({
    label: 'poll-reviews removes the card the moment changes-requested is detected',
    reviewState: 'CHANGES_REQUESTED',
    expectedReason: 'changes_requested',
  })

  await runOperatorScenario({
    label: 'poll-reviews removes the card the moment a plain-comment review is detected',
    reviewState: 'COMMENTED',
    expectedReason: 'commented',
  })
} else {
  console.log('  skip — operator-mode poll-reviews checks (SUPABASE_SERVICE_ROLE_KEY not set)')
}

if (failed > 0) {
  console.error(`\nSMOKE FAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nSmoke checks passed.')
