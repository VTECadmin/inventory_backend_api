-- ─────────────────────────────────────────
-- 0002 — Optional equipment-registry detail fields on items
-- (kept separate from the core fields; not all items use them)
-- ─────────────────────────────────────────

ALTER TABLE items
  ADD COLUMN serial_number           VARCHAR(255),
  ADD COLUMN manufacturer            VARCHAR(255),
  ADD COLUMN manufacturer_contact    TEXT,
  ADD COLUMN owner                   VARCHAR(255),
  ADD COLUMN device_status           VARCHAR(100),
  ADD COLUMN label_printed           BOOLEAN,
  ADD COLUMN calibration_required    BOOLEAN,
  ADD COLUMN calibration_method      TEXT,
  ADD COLUMN maintenance_next        DATE,
  ADD COLUMN maintenance_last        DATE,
  ADD COLUMN maintenance_freq_months INT,
  ADD COLUMN service_provider        VARCHAR(255),
  ADD COLUMN service_provider_contact TEXT,
  ADD COLUMN training_required       BOOLEAN,
  ADD COLUMN training_material       TEXT,
  ADD COLUMN trainer                 VARCHAR(255),
  ADD COLUMN date_of_purchase        DATE,
  ADD COLUMN date_in_service         DATE;
