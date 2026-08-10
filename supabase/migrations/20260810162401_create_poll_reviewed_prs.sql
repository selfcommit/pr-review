/*
# Create poll_reviewed_prs table

Tracks PRs that the poll handler detected as already reviewed by the user.
GitHub's search index can lag behind the actual review state, causing
reviewed PRs to keep reappearing in search results. This table acts as
a persistent filter: once a review is detected, the PR ID is recorded
here and filtered out on every subsequent poll, preventing the PR from
bouncing back into the dashboard.

Entries are cleaned up automatically when the PR finally leaves the
search results.

1. New Tables
  - `poll_reviewed_prs`
    - `github_user_id` (bigint) - reviewer GitHub user id
    - `pr_id` (bigint) - GitHub PR id
    - `review_state` (text) - the detected review state (approved, changes_requested, commented)
    - `detected_at` (timestamptz) - when the review was first detected
    - Primary key (github_user_id, pr_id)
2. Security
  - Enable RLS
  - No client policies: only the edge function (service role) reads or writes
*/

CREATE TABLE IF NOT EXISTS poll_reviewed_prs (
  github_user_id bigint NOT NULL,
  pr_id bigint NOT NULL,
  review_state text NOT NULL DEFAULT '',
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (github_user_id, pr_id)
);

ALTER TABLE poll_reviewed_prs ENABLE ROW LEVEL SECURITY;
