/*
  # Create review_requests cache table

  1. New Tables
    - `review_requests`
      - `id` (uuid, primary key) - Unique row identifier
      - `github_user_id` (bigint, FK to app_users) - The user whose review was requested
      - `pr_id` (bigint) - The GitHub issue/PR ID (from search results)
      - `pr_number` (integer) - The PR number within the repo
      - `repo_full_name` (text) - Full repo name, e.g. "org/repo"
      - `review_requested_at` (timestamptz) - Exact timestamp from the GitHub timeline event
      - `created_at` (timestamptz) - When this cache row was created

  2. Indexes
    - Unique constraint on (github_user_id, pr_id) so each user/PR pair has one cached row
    - Index on github_user_id for fast lookups

  3. Security
    - Enable RLS on `review_requests` table
    - Only service_role can read/write (all access via edge functions)
*/

CREATE TABLE IF NOT EXISTS review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES app_users(github_user_id) ON DELETE CASCADE,
  pr_id bigint NOT NULL,
  pr_number integer NOT NULL,
  repo_full_name text NOT NULL,
  review_requested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(github_user_id, pr_id)
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can select review_requests"
  ON review_requests FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert review_requests"
  ON review_requests FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update review_requests"
  ON review_requests FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete review_requests"
  ON review_requests FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_review_requests_github_user_id ON review_requests(github_user_id);
