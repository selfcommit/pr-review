/*
  # Add public_profile_hidden to app_users

  1. Modified Tables
    - `app_users`
      - `public_profile_hidden` (boolean, default false) - when true, the
        user's public stats profile at /u/<login> is not accessible.
        Defaults to false so profiles are public by default (opt-out).

  2. Security
    - No RLS changes. The public stats endpoint is served by the edge
      function using the service role and enforces this flag in code.

  3. Notes
    1. Existing rows are backfilled with the default `false` value.
    2. Users can toggle this via a new /profile-visibility endpoint.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'public_profile_hidden'
  ) THEN
    ALTER TABLE app_users
      ADD COLUMN public_profile_hidden boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_users_login_lower_idx
  ON app_users (lower(login));
