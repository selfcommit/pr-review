/*
# Add index on pr_reviews(repo_full_name, submitted_at) for repo-wide P90 queries

1. New Indexes
  - `idx_pr_reviews_repo_submitted` on `pr_reviews(repo_full_name, submitted_at DESC)`
  - Supports efficient queries that aggregate review latencies across ALL users
    for a given repository within a time window.

2. Purpose
  - The Stats page now shows a "repo-wide P90 review time" alongside the user's
    personal P90. This requires querying all reviews for a repo regardless of user.
  - Without this index, those queries would require a full table scan.
*/

CREATE INDEX IF NOT EXISTS idx_pr_reviews_repo_submitted
  ON pr_reviews (repo_full_name, submitted_at DESC);
