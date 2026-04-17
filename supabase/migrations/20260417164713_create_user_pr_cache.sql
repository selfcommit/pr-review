/*
  # Create user_pr_cache table for stale-while-revalidate page loads

  1. New Tables
    - `user_pr_cache`
      - `github_user_id` (bigint, primary key) - Owning user
      - `payload` (jsonb) - Full last-successful pull-requests edge function response
      - `updated_at` (timestamptz) - When this cache row was last refreshed

  2. Purpose
    This table stores the last successful `pull-requests` response so that on
    subsequent page loads the dashboard can render instantly from cache while
    a fresh fetch runs in the background (stale-while-revalidate).

  3. Security
    - RLS enabled; no policies are added so only the service role (edge
      functions) can read/write. This matches the existing `user_pr_snapshots`
      and `pr_reviews` pattern.
*/

CREATE TABLE IF NOT EXISTS user_pr_cache (
  github_user_id bigint PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_pr_cache ENABLE ROW LEVEL SECURITY;
