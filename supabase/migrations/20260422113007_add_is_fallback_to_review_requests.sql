/*
  # Add is_fallback_timestamp column to review_requests

  1. Changes
    - Adds `is_fallback_timestamp` (boolean, default false) to `review_requests`
    - When true, the cached `review_requested_at` is a fallback (e.g. PR created_at)
      because GitHub did not return an actual REVIEW_REQUESTED_EVENT we could read.
    - Allows the edge function to re-attempt an accurate lookup on next poll.

  2. Security
    - No RLS changes; existing service_role-only policies apply.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'review_requests' AND column_name = 'is_fallback_timestamp'
  ) THEN
    ALTER TABLE review_requests ADD COLUMN is_fallback_timestamp boolean NOT NULL DEFAULT false;
  END IF;
END $$;
