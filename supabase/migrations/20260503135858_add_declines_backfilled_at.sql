/*
  # Add declines_backfilled_at to app_users

  1. Modified Tables
    - `app_users`
      - `declines_backfilled_at` (timestamptz, nullable) - tracks when the
        one-shot historical decline-comment scan completed for a user.
        NULL means the deep scan has not yet run for this user.

  2. Security
    - No RLS changes. `app_users` access policies remain as-is.
    - This column is written only by the edge function using the service role.

  3. Notes
    1. This supports retroactive detection of `:runner:` decline comments on
       PRs the user had already formally reviewed.
    2. Once set, subsequent manual "Refresh Stats" clicks skip the deep scan
       and do a normal force refresh.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'declines_backfilled_at'
  ) THEN
    ALTER TABLE app_users ADD COLUMN declines_backfilled_at timestamptz;
  END IF;
END $$;
