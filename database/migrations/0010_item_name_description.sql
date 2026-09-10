-- ─────────────────────────────────────────
-- 0010 — Rename item text columns for clearer naming
-- The item's main label lived in `description` (required) but it is really the
-- item's NAME. The optional free-text `notes` becomes the item's `description`.
-- Result: items.name (required) + items.description (optional).
-- (This does NOT touch item_transactions.notes — that is a separate column.)
-- ─────────────────────────────────────────

ALTER TABLE items RENAME COLUMN description TO name;
ALTER TABLE items RENAME COLUMN notes TO description;
