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

if (failed > 0) {
  console.error(`\nSMOKE FAIL: ${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nSmoke checks passed.')
