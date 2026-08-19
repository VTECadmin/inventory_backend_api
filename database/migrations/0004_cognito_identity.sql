-- ─────────────────────────────────────────
-- 0004 — Link users to their Cognito identity
-- Authentication moves to the company's Cognito user pool. This column ties a
-- Cognito user (its immutable "sub") to the local users row that the rest of the
-- app references by numeric id. Existing rows are linked on first sign-in
-- (matched by email); unknown users are provisioned on the fly.
-- ─────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN cognito_sub VARCHAR(255) UNIQUE;
