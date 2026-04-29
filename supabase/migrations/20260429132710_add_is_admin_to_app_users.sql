/*
  # Add is_admin flag to app_users

  1. Changes
    - Add `is_admin` boolean column to `app_users` (default false)
  2. Security
    - No RLS policy changes; admin access is enforced by the `github-auth` edge function
      using the service role key. Direct client writes remain blocked.
  3. Notes
    1. Promote a user to admin by running:
       UPDATE app_users SET is_admin = true WHERE login = 'your-github-login';
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE app_users ADD COLUMN is_admin boolean NOT NULL DEFAULT false;
  END IF;
END $$;
