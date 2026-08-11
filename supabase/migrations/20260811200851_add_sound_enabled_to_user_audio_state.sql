ALTER TABLE user_audio_state
  ADD COLUMN IF NOT EXISTS sound_enabled boolean NOT NULL DEFAULT true;
