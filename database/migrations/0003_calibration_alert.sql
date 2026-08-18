-- ─────────────────────────────────────────
-- 0003 — Calibration reminder threshold on items
-- How much time before the next calibration (maintenance_next) we start
-- flagging the item as "calibration due" — a value plus its unit (days/months).
-- ─────────────────────────────────────────

ALTER TABLE items
  ADD COLUMN calibration_alert_value INT,
  ADD COLUMN calibration_alert_unit  VARCHAR(10);   -- 'days' | 'months'
