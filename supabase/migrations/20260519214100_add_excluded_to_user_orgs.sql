/*
  # Add excluded column to user_orgs

  1. Modified Tables
    - `user_orgs`
      - Added `excluded` (boolean, default false) - when true, PRs from this org are hidden from the user's review dashboard

  2. Notes
    - Existing rows default to false (all orgs visible)
    - This allows users to opt specific orgs out of the PR review queue
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_orgs' AND column_name = 'excluded'
  ) THEN
    ALTER TABLE user_orgs ADD COLUMN excluded boolean NOT NULL DEFAULT false;
  END IF;
END $$;
