-- ─────────────────────────────────────────
-- 0007 — Soft-delete ("Retire") for items
-- A hard DELETE is blocked once an item has any transaction history, so used
-- equipment that's physically gone (sold, scrapped, decommissioned) could never
-- leave the inventory. A nullable deleted_at lets any item be retired: hidden
-- from the active list, counts, stats and exports, while its past transactions
-- stay valid. Consistent with projects (0006).
-- ─────────────────────────────────────────

ALTER TABLE items
  ADD COLUMN deleted_at TIMESTAMP;
