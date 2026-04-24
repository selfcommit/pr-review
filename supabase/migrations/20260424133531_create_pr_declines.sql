/*
  # Create pr_declines table

  Records PRs that a reviewer has permanently declined by commenting
  the :runner: emoji. Declined PRs are excluded from the pending reviews
  dashboard and from review-time stats calculations.

  1. New Tables
    - `pr_declines`
      - `github_user_id` (bigint) - reviewer GitHub user id
      - `pr_id` (bigint) - GitHub PR id
      - `pr_number` (integer) - PR number within its repo
      - `repo_full_name` (text) - owner/repo
      - `pr_title` (text) - cached PR title
      - `pr_html_url` (text) - cached PR url
      - `declined_at` (timestamptz) - time of the earliest matching comment
      - `comment_id` (bigint) - GitHub comment databaseId used to decline
      - Primary key (github_user_id, pr_id)
  2. Indexes
    - (github_user_id, declined_at) for window-filtered stats queries
  3. Security
    - Enable RLS
    - No client policies: only the edge function (service role) reads or writes
*/

CREATE TABLE IF NOT EXISTS pr_declines (
  github_user_id bigint NOT NULL,
  pr_id bigint NOT NULL,
  pr_number integer NOT NULL DEFAULT 0,
  repo_full_name text NOT NULL DEFAULT '',
  pr_title text NOT NULL DEFAULT '',
  pr_html_url text NOT NULL DEFAULT '',
  declined_at timestamptz NOT NULL DEFAULT now(),
  comment_id bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_user_id, pr_id)
);

CREATE INDEX IF NOT EXISTS pr_declines_user_declined_at_idx
  ON pr_declines (github_user_id, declined_at DESC);

ALTER TABLE pr_declines ENABLE ROW LEVEL SECURITY;
