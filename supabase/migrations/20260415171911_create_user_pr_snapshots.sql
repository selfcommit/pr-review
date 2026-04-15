/*
  # Create user_pr_snapshots table for polling comparison

  1. New Tables
    - `user_pr_snapshots`
      - `id` (uuid, primary key) - Unique row identifier
      - `github_user_id` (bigint, FK to app_users) - The user whose review-requested PRs are tracked
      - `pr_id` (bigint) - The GitHub issue/PR ID from search results
      - `pr_number` (integer) - The PR number within the repo
      - `repo_full_name` (text) - Full repo name, e.g. "org/repo"
      - `state` (text) - PR state (open/closed)
      - `draft` (boolean) - Whether the PR is a draft
      - `title` (text) - PR title
      - `html_url` (text) - URL to the PR on GitHub
      - `author_login` (text) - PR author's GitHub login
      - `author_avatar_url` (text) - PR author's avatar URL
      - `pull_request_merged` (boolean) - Whether the PR has been merged
      - `pr_updated_at` (timestamptz) - The PR's updated_at timestamp from GitHub
      - `snapshot_at` (timestamptz) - When this snapshot row was last synced
      - `created_at` (timestamptz) - When this row was first created

  2. Indexes
    - Unique constraint on (github_user_id, pr_id) so each user/PR pair has one snapshot row
    - Index on github_user_id for fast lookups

  3. Security
    - Enable RLS on `user_pr_snapshots` table
    - Only service_role can read/write (all access via edge functions)

  4. Purpose
    - Stores the last-known state of each user's review-requested PRs
    - The poll-reviews endpoint compares fresh GitHub data against these snapshots
      to detect new, updated, and removed PRs without the frontend needing to track state
*/

CREATE TABLE IF NOT EXISTS user_pr_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES app_users(github_user_id) ON DELETE CASCADE,
  pr_id bigint NOT NULL,
  pr_number integer NOT NULL,
  repo_full_name text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'open',
  draft boolean NOT NULL DEFAULT false,
  title text NOT NULL DEFAULT '',
  html_url text NOT NULL DEFAULT '',
  author_login text NOT NULL DEFAULT '',
  author_avatar_url text NOT NULL DEFAULT '',
  pull_request_merged boolean NOT NULL DEFAULT false,
  pr_updated_at timestamptz NOT NULL DEFAULT now(),
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(github_user_id, pr_id)
);

ALTER TABLE user_pr_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can select user_pr_snapshots"
  ON user_pr_snapshots FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert user_pr_snapshots"
  ON user_pr_snapshots FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update user_pr_snapshots"
  ON user_pr_snapshots FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete user_pr_snapshots"
  ON user_pr_snapshots FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_user_pr_snapshots_github_user_id ON user_pr_snapshots(github_user_id);
