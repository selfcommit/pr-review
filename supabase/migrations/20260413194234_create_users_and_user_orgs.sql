/*
  # Create users and user_orgs tables

  1. New Tables
    - `app_users`
      - `github_user_id` (bigint, primary key) - GitHub user ID
      - `login` (text) - GitHub username
      - `name` (text, nullable) - Display name
      - `avatar_url` (text, nullable) - Profile picture URL
      - `email` (text, nullable) - Email address
      - `access_token` (text) - GitHub OAuth access token
      - `oauth_scopes` (text, nullable) - Granted OAuth scopes
      - `session_token` (uuid) - Opaque session token for frontend auth
      - `created_at` (timestamptz) - When the user first signed in
      - `updated_at` (timestamptz) - When the user record was last updated

    - `user_orgs`
      - `id` (uuid, primary key) - Unique row identifier
      - `github_user_id` (bigint, FK to app_users) - The user who belongs to this org
      - `org_login` (text) - Organization login name
      - `org_id` (bigint, nullable) - GitHub org ID
      - `org_avatar_url` (text, nullable) - Org avatar
      - `role` (text) - User's role in the org (admin/member)
      - `accessible` (boolean) - Whether the app has access to this org's data
      - `last_synced_at` (timestamptz) - When org access was last checked
      - `created_at` (timestamptz) - When this record was first created

  2. Security
    - Enable RLS on both tables
    - Only service_role can read/write app_users (contains tokens)
    - Only service_role can write user_orgs
    - Authenticated users cannot directly access these tables (all access via edge functions)
*/

CREATE TABLE IF NOT EXISTS app_users (
  github_user_id bigint PRIMARY KEY,
  login text NOT NULL,
  name text,
  avatar_url text,
  email text,
  access_token text NOT NULL,
  oauth_scopes text,
  session_token uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can select app_users"
  ON app_users FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert app_users"
  ON app_users FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update app_users"
  ON app_users FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete app_users"
  ON app_users FOR DELETE
  TO service_role
  USING (true);

CREATE TABLE IF NOT EXISTS user_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  github_user_id bigint NOT NULL REFERENCES app_users(github_user_id) ON DELETE CASCADE,
  org_login text NOT NULL,
  org_id bigint,
  org_avatar_url text,
  role text NOT NULL DEFAULT 'member',
  accessible boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(github_user_id, org_login)
);

ALTER TABLE user_orgs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can select user_orgs"
  ON user_orgs FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "Service role can insert user_orgs"
  ON user_orgs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update user_orgs"
  ON user_orgs FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete user_orgs"
  ON user_orgs FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_user_orgs_github_user_id ON user_orgs(github_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_session_token ON app_users(session_token);
