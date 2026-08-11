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

if (SUPABASE_SERVICE_ROLE_KEY) {
  await check('poll-reviews accepts a live seeded session and returns the expected shape', async () => {
    const stamp = Date.now()
    const syntheticGithubId = 900000000 + (stamp % 1000000)
    const sessionToken = `smoke-${stamp}-${Math.random().toString(36).slice(2, 10)}`
    const login = `smoke-user-${stamp}`

    await supabaseAdmin('POST', 'app_users', {
      github_user_id: syntheticGithubId,
      login,
      name: 'Smoke Check User',
      avatar_url: '',
      access_token: 'smoke-check-bogus-github-token',
      session_token: sessionToken,
    })

    try {
      const res = await fetch(`${base}/poll-reviews`, {
        headers: { Authorization: `Bearer ${sessionToken}` },
      })
      // The synthetic access token is not a real GitHub token, so the endpoint
      // should surface GitHub's 401 as { code: "token_expired" }. Anything
      // other than 401 (e.g. a 500 crash) is a regression.
      if (res.status !== 401) {
        throw new Error(`expected 401 from bogus github token, got ${res.status}`)
      }
      const body = await res.json().catch(() => ({}))
      if (body.code !== 'token_expired') {
        throw new Error(`expected code=token_expired, got ${JSON.stringify(body)}`)
      }
    } finally {
      await supabaseAdmin(
        'DELETE',
        `app_users?github_user_id=eq.${syntheticGithubId}`,
      ).catch(() => {})
    }
  })
} else {
  console.log('  skip — live seeded-session poll-reviews check (SUPABASE_SERVICE_ROLE_KEY not set)')
}

if (failed > 0) {
  console.error(`\nSMOKE FAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nSmoke checks passed.')
