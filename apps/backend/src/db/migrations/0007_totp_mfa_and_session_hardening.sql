ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mfa_totp_secret_enc" text,
  ADD COLUMN IF NOT EXISTS "mfa_totp_pending_secret_enc" text,
  ADD COLUMN IF NOT EXISTS "mfa_totp_pending_created_at" timestamp,
  ADD COLUMN IF NOT EXISTS "mfa_totp_enabled_at" timestamp;

ALTER TABLE "auth_sessions"
  ADD COLUMN IF NOT EXISTS "mfa_verified_at" timestamp;
