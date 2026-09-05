-- ─────────────────────────────────────────
-- 0005 — Indexes on item_transactions for faster inventory reads
-- The inventory list computes a per-item "borrowed" quantity with a correlated
-- subquery over item_transactions (also reused inside the low-stock test), and
-- item history / undo filter by item_id. With only a primary key on id, every
-- such lookup is a sequential scan; as the table grows this dominates the list
-- query (evaluated for the whole result set because of COUNT(*) OVER()).
-- ─────────────────────────────────────────

-- Broad: any lookup of an item's transactions (history, undo, borrowed).
CREATE INDEX IF NOT EXISTS idx_item_transactions_item
  ON item_transactions (item_id);

-- Targeted: the "borrowed" subquery — SUM(qty) of active borrows per item.
CREATE INDEX IF NOT EXISTS idx_item_transactions_active_borrow
  ON item_transactions (item_id)
  WHERE action = 'borrow' AND status = 'active';
