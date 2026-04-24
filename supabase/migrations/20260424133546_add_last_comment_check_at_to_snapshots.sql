/*
  # Add last_comment_check_at to user_pr_snapshots

  Lets the poll-reviews handler throttle how often it scans a given PR's
  comments for the :runner: decline marker. Unchanged PRs that were checked
  recently can be skipped without re-hitting the GitHub GraphQL API.

  1. Modified Tables
    - `user_pr_snapshots`
      - Add `last_comment_check_at` (timestamptz, nullable) - last time we
        scanned this PR's comments for a decline marker.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_pr_snapshots' AND column_name = 'last_comment_check_at'
  ) THEN
    ALTER TABLE user_pr_snapshots ADD COLUMN last_comment_check_at timestamptz;
  END IF;
END $$;
