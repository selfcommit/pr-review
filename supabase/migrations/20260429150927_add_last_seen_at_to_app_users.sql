/*
  # Add last_seen_at to app_users

  1. Schema Changes
    - Adds `last_seen_at` (timestamptz, nullable) column to `app_users`
      to track the most recent time a user's session was validated via the `me` endpoint.
      This gives a true "last login/activity" signal independent of PR-review backfill data.

  2. Notes
    - Column is nullable; existing rows start as NULL until users next hit the app.
    - No RLS changes required (table RLS already configured).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'last_seen_at'
  ) THEN
    ALTER TABLE app_users ADD COLUMN last_seen_at timestamptz;
  END IF;
END $$;
