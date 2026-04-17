/*
  # Add RLS policies for user_audio_state

  The `user_audio_state` table is only accessed by the `github-auth` edge
  function via the service role key (which bypasses RLS). No direct client
  access is ever expected. This migration adds explicit deny-all policies
  for `authenticated` and `anon` roles to satisfy the "RLS enabled, no policy"
  security advisor and make the restriction explicit.

  1. Security
    - All four operations (SELECT, INSERT, UPDATE, DELETE) denied for
      `authenticated` and `anon` roles.
    - Service role continues to bypass RLS and can freely manage rows.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny select to authenticated'
  ) THEN
    CREATE POLICY "Deny select to authenticated"
      ON user_audio_state FOR SELECT
      TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny insert to authenticated'
  ) THEN
    CREATE POLICY "Deny insert to authenticated"
      ON user_audio_state FOR INSERT
      TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny update to authenticated'
  ) THEN
    CREATE POLICY "Deny update to authenticated"
      ON user_audio_state FOR UPDATE
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny delete to authenticated'
  ) THEN
    CREATE POLICY "Deny delete to authenticated"
      ON user_audio_state FOR DELETE
      TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny select to anon'
  ) THEN
    CREATE POLICY "Deny select to anon"
      ON user_audio_state FOR SELECT
      TO anon
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny insert to anon'
  ) THEN
    CREATE POLICY "Deny insert to anon"
      ON user_audio_state FOR INSERT
      TO anon
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny update to anon'
  ) THEN
    CREATE POLICY "Deny update to anon"
      ON user_audio_state FOR UPDATE
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_audio_state' AND policyname = 'Deny delete to anon'
  ) THEN
    CREATE POLICY "Deny delete to anon"
      ON user_audio_state FOR DELETE
      TO anon
      USING (false);
  END IF;
END $$;
