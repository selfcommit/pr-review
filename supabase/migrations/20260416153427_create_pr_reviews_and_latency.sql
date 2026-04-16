/*
  # Create pr_reviews table and add reviewed_at to review_requests

  Adds infrastructure to track user review activity for the Stats tab.

  1. New Tables
    - `pr_reviews`
      - Captures each review a user has submitted on a PR
      - Includes review state (approved/changes_requested/commented/dismissed)
      - Enables per-repo counts and P90 latency calculations

  2. Schema Changes
    - Adds `reviewed_at` timestamp column to `review_requests`
      - Stamped when we detect that the user completed their review
      - Used together with `review_requested_at` to compute review latency

  3. Security
    - RLS enabled on `pr_reviews`
    - Policies restrict all access to the row's own `github_user_id`
    - Matching read via session_token on app_users

  4. Indexes
    - `pr_reviews(github_user_id, repo_full_name, submitted_at)` for per-repo aggregates
*/

CREATE TABLE IF NOT EXISTS pr_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES app_users(github_user_id) ON DELETE CASCADE,
  pr_id bigint NOT NULL,
  pr_number integer NOT NULL,
  repo_full_name text NOT NULL DEFAULT '',
  pr_title text NOT NULL DEFAULT '',
  pr_html_url text NOT NULL DEFAULT '',
  review_id bigint NOT NULL,
  review_state text NOT NULL DEFAULT 'commented',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  latency_seconds bigint,
  created_at timestamptz DEFAULT now(),
  UNIQUE (github_user_id, review_id)
);

ALTER TABLE pr_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pr_reviews_user_repo_submitted
  ON pr_reviews (github_user_id, repo_full_name, submitted_at DESC);

CREATE POLICY "Users can read own pr_reviews via session"
  ON pr_reviews FOR SELECT
  TO authenticated
  USING (
    github_user_id IN (
      SELECT github_user_id FROM app_users WHERE session_token::text = current_setting('request.jwt.claim.sub', true)
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_requests' AND column_name = 'reviewed_at'
  ) THEN
    ALTER TABLE review_requests ADD COLUMN reviewed_at timestamptz;
  END IF;
END $$;
