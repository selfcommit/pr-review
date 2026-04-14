/*
  # Remove GitHub App infrastructure

  1. Changes
    - Drop `accessible` column from `user_orgs` table (no longer needed since
      all orgs are accessible via the user's OAuth token with repo + read:org scopes)
    - Drop `installations` table (tracked GitHub App installations, no longer relevant)
    - Drop `webhook_events` table (tracked GitHub App webhook events, no longer relevant)

  2. Invalidate existing sessions
    - Regenerate all session_token values in `app_users` to force re-authentication
      so users get new tokens with the required OAuth scopes

  3. Important Notes
    - No data loss for user accounts or org memberships
    - Users will need to sign in again after this migration to get properly-scoped tokens
*/

ALTER TABLE user_orgs DROP COLUMN IF EXISTS accessible;

DROP TABLE IF EXISTS webhook_events;

DROP TABLE IF EXISTS installations;

UPDATE app_users SET session_token = gen_random_uuid(), updated_at = now();
