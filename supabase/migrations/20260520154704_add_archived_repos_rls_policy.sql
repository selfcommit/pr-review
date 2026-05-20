/*
  # Add RLS policy for archived_repos table

  1. Security
    - Add policy allowing service role full access to `archived_repos`
    - This table is only accessed by edge functions using the service role key
    - No authenticated user should directly access this table

  2. Notes
    - The table is a server-side cache, not user-facing data
*/

CREATE POLICY "Service role has full access to archived_repos"
  ON archived_repos
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
