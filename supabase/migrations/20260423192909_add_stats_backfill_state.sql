/*
  # Add stats backfill state and window index

  1. Schema Changes
    - Add `stats_backfilled_at timestamptz` column to `app_users`.
      - Tracks when we last completed a historical review backfill for the user.
      - Used to avoid re-hitting the GitHub API on every /stats load.

  2. Indexes
    - Add `idx_pr_reviews_user_submitted_window` on `pr_reviews(github_user_id, submitted_at DESC)`
      to keep the 120-day rolling window query fast.

  3. Security
    - No new tables, RLS unchanged.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'stats_backfilled_at'
  ) THEN
    ALTER TABLE app_users ADD COLUMN stats_backfilled_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pr_reviews_user_submitted_window
  ON pr_reviews (github_user_id, submitted_at DESC);
