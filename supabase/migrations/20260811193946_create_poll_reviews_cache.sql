CREATE TABLE IF NOT EXISTS poll_reviews_cache (
  github_user_id BIGINT PRIMARY KEY,
  payload JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE poll_reviews_cache ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge functions) reads or writes this cache; no
-- authenticated user policy is created on purpose so RLS denies all direct
-- client access.
