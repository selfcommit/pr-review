ALTER TABLE user_audio_state
  ADD COLUMN IF NOT EXISTS desktop_notifications_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_desktop_notification_at timestamptz;
