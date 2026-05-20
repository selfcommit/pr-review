/*
  # Create archived repos cache table

  1. New Tables
    - `archived_repos`
      - `repo_full_name` (text, primary key) - owner/repo format
      - `is_archived` (boolean) - whether the repo is archived
      - `checked_at` (timestamptz) - when the archived status was last verified

  2. Security
    - Enable RLS on `archived_repos` table
    - No client-facing policies - only accessed via service role from edge functions

  3. Notes
    - This table caches the archived status of repositories to avoid redundant GitHub API calls
    - Entries older than 24 hours are considered stale and will be re-checked
*/

CREATE TABLE IF NOT EXISTS archived_repos (
  repo_full_name text PRIMARY KEY,
  is_archived boolean NOT NULL DEFAULT false,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS archived_repos_checked_at_idx
  ON archived_repos (checked_at);

ALTER TABLE archived_repos ENABLE ROW LEVEL SECURITY;
