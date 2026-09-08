-- ─────────────────────────────────────────
-- 0006 — Soft-delete for projects
-- item_transactions.project_id and items.project_id both reference projects with
-- NO ACTION, so a hard DELETE is blocked as soon as a project has any history.
-- A nullable deleted_at lets us hide a project from the list (once its items are
-- released) while keeping past assign/release transactions intact.
-- ─────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN deleted_at TIMESTAMP;
