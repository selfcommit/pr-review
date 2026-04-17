/*
  # Add RLS policies to user_pr_cache

  1. Security
    - Adds restrictive RLS policies for the `user_pr_cache` table which currently
      has RLS enabled but no policies (causing the table to be effectively locked
      to authenticated/anon roles while the security linter flags the missing
      policies).
    - Policies deny all direct access from the `authenticated` and `anon` roles
      by evaluating to `false`. The service role (used by edge functions) bypasses
      RLS and will continue to read/write this cache as before.

  2. Notes
    - This table is an internal cache populated and read exclusively by the
      `pull-requests` edge function using the service role. End-user clients must
      never query it directly.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny select to authenticated'
  ) THEN
    CREATE POLICY "Deny select to authenticated"
      ON user_pr_cache FOR SELECT
      TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny insert to authenticated'
  ) THEN
    CREATE POLICY "Deny insert to authenticated"
      ON user_pr_cache FOR INSERT
      TO authenticated
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny update to authenticated'
  ) THEN
    CREATE POLICY "Deny update to authenticated"
      ON user_pr_cache FOR UPDATE
      TO authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny delete to authenticated'
  ) THEN
    CREATE POLICY "Deny delete to authenticated"
      ON user_pr_cache FOR DELETE
      TO authenticated
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny select to anon'
  ) THEN
    CREATE POLICY "Deny select to anon"
      ON user_pr_cache FOR SELECT
      TO anon
      USING (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny insert to anon'
  ) THEN
    CREATE POLICY "Deny insert to anon"
      ON user_pr_cache FOR INSERT
      TO anon
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny update to anon'
  ) THEN
    CREATE POLICY "Deny update to anon"
      ON user_pr_cache FOR UPDATE
      TO anon
      USING (false)
      WITH CHECK (false);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_pr_cache' AND policyname = 'Deny delete to anon'
  ) THEN
    CREATE POLICY "Deny delete to anon"
      ON user_pr_cache FOR DELETE
      TO anon
      USING (false);
  END IF;
END $$;
