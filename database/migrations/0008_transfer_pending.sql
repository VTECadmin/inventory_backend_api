-- ─────────────────────────────────────────
-- 0008 — Two-step transfers (handshake)
-- A transfer is no longer immediate: it's proposed as a 'pending' transfer that
-- the recipient must accept (or decline) before the borrow actually moves to
-- them. Two new transaction_status values carry that state.
-- ─────────────────────────────────────────

ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE transaction_status ADD VALUE IF NOT EXISTS 'declined';
