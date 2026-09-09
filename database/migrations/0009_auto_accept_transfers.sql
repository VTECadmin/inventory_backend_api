-- ─────────────────────────────────────────
-- 0009 — Per-user "auto-accept transfers" preference
-- When on, transfers proposed to this user are finalized immediately instead of
-- waiting for a manual accept. Off by default; each user toggles their own.
-- ─────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN auto_accept_transfers BOOLEAN NOT NULL DEFAULT false;
