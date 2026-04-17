/*
  # Create user_audio_state table

  Persists per-user audio playback priming state so the dashboard can more
  aggressively attempt to play notification chimes on return visits, even in
  background/unfocused tabs.

  1. New Tables
    - `user_audio_state`
      - `github_user_id` (bigint, PK, FK to app_users)
      - `audio_unlocked` (boolean, default false) - whether this user has
        successfully played audio in the app at least once
      - `last_unlocked_at` (timestamptz, nullable)
      - `updated_at` (timestamptz, default now())

  2. Security
    - Enable RLS
    - Access is restricted: the table is read/written only by the service role
      through the github-auth edge function (session_token-based auth).
      No direct authenticated-user policies are needed because the frontend
      does not use supabase-js directly.

  3. Notes
    - Service role bypasses RLS, so the edge function can freely read/write.
*/

CREATE TABLE IF NOT EXISTS user_audio_state (
  github_user_id bigint PRIMARY KEY REFERENCES app_users(github_user_id) ON DELETE CASCADE,
  audio_unlocked boolean NOT NULL DEFAULT false,
  last_unlocked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_audio_state ENABLE ROW LEVEL SECURITY;
