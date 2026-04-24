/*
  # Add service_role RLS policies for pr_declines

  The pr_declines table is accessed only by the github-auth edge function
  using the service role. Client code never reads or writes this table
  directly. Adds explicit policies so RLS is not just enabled but also
  has a matching access grant for service_role.

  1. Security
    - Add SELECT, INSERT, UPDATE, DELETE policies limited to service_role
    - No authenticated or anon policies (table remains locked down to clients)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pr_declines'
      AND policyname = 'Service role can select pr_declines'
  ) THEN
    CREATE POLICY "Service role can select pr_declines"
      ON pr_declines FOR SELECT
      TO service_role
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pr_declines'
      AND policyname = 'Service role can insert pr_declines'
  ) THEN
    CREATE POLICY "Service role can insert pr_declines"
      ON pr_declines FOR INSERT
      TO service_role
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pr_declines'
      AND policyname = 'Service role can update pr_declines'
  ) THEN
    CREATE POLICY "Service role can update pr_declines"
      ON pr_declines FOR UPDATE
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pr_declines'
      AND policyname = 'Service role can delete pr_declines'
  ) THEN
    CREATE POLICY "Service role can delete pr_declines"
      ON pr_declines FOR DELETE
      TO service_role
      USING (true);
  END IF;
END $$;
