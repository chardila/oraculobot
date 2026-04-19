-- Migration 004: Web authentication support
-- Adds Supabase Auth integration and rate limiting for DeepSeek questions

-- Allow web-only users (no Telegram account)
ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

-- Link web users to Supabase Auth identities
ALTER TABLE users ADD COLUMN auth_user_id uuid REFERENCES auth.users(id);
CREATE UNIQUE INDEX idx_users_auth_user_id ON users(auth_user_id);

-- Rate limiting for DeepSeek questions (reset daily)
ALTER TABLE users ADD COLUMN questions_today int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN questions_reset_at date;
