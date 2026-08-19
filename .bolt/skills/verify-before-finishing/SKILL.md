---
name: verify-before-finishing
description: >-
  Required verification steps for this project: run the automated tests (and, after backend
  changes, the live smoke check) before ending any turn that changed code. Activate on ANY
  prompt that edits application code (src/**), the backend sign-in / edge function
  (supabase/functions/**), database migrations (supabase/migrations/**), or build/config files —
  even when the user does not mention testing. This exists because sign-in once broke in
  production after a deploy that no test gate ever caught; these checks are how we stop that from
  happening again.
---

# Verify before finishing

This project ships to real users, and a past deploy silently broke GitHub sign-in because nothing
ran the tests between the code change and the live backend. Bolt's Publish only runs the build
command — it does not run the network smoke check, and it does not run automatically after each
prompt. So the safety net has to be a habit enforced here: a change is not "done" until the
automated checks that protect sign-in and the core flows have actually run and passed.

## What to run, and when

Decide based on what the change touched. Run the narrowest set that covers it, but never skip a
step that applies.

- **Any code change under `src/**` or shared logic** — run the unit tests:

  ```
  npm test
  ```

  These must pass before you end the turn. The build command (`tsc && vitest run && vite build`)
  runs the same tests at Publish time, so a failure here is a failure that would block publishing
  anyway — catch it now, not later.

- **Any change to the backend function (`supabase/functions/**`), OR any redeploy of that function
  (including flipping the "require login token" / verify_jwt setting)** — after the deploy, also
  run the live smoke check:

  ```
  npm run smoke
  ```

  This calls the deployed sign-in URL with no login token and confirms it still redirects to
  GitHub instead of returning "Missing authorization header". This is the exact check that would
  have caught the earlier outage, and it is the only check that talks to the live backend — the
  build never runs it. Run it after deploying, because it tests what is actually live, not the
  local source.

- **Database migrations (`supabase/migrations/**`)** — run `npm test` as above, and if the
  migration affects anything the backend function reads or writes, also run `npm run smoke` after
  applying it.

## When a check can't run

Report honestly; never imply a check passed when it did not run.

- If `npm run smoke` cannot reach the backend or its required settings are missing, still run
  `npm test`, and tell the user plainly that the live smoke check was skipped and why. Do not treat
  a skipped check as a passed check.
- If a required check fails, do not end the turn as if the work succeeded. Fix the cause, or if you
  cannot, describe the failure to the user in plain, non-technical language with a suggested next
  step.

## Reporting

In your closing summary, it is fine to stay non-technical, but the outcome must be truthful: if a
check failed or was skipped, say so and say what it means for them. Never characterize broken or
unverified work as done.
