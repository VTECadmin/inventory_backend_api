-- ─────────────────────────────────────────
-- 0001 — Baseline schema (full current schema)
-- ─────────────────────────────────────────

-- Enums
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'employee');

CREATE TYPE transaction_status AS ENUM (
  'active',
  'returned',
  'broken',
  'transferred'
);

CREATE TYPE project_status AS ENUM ('active', 'completed');

CREATE TYPE action AS ENUM (
  'take',
  'borrow',
  'return',
  'assign_to_project',
  'release_from_project',
  'breakdown',
  'transfer'
);

-- Tables
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  user_role     user_role    NOT NULL
);

CREATE TABLE categories (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
);

-- Locations are managed data (add/remove from the interface), not a fixed enum.
CREATE TABLE locations (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
);

INSERT INTO locations (name) VALUES
  ('Meeting Room'), ('Storage Room'), ('Lab 01'), ('Lab 02'), ('Lab 03');

CREATE TABLE projects (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255)   NOT NULL,
  status     project_status NOT NULL DEFAULT 'active',
  created_by INT            NOT NULL REFERENCES users(id)
);

CREATE TABLE items (
  id             SERIAL PRIMARY KEY,
  part_id        VARCHAR(100),
  description    TEXT         NOT NULL,
  category_id    INT          REFERENCES categories(id),
  location_id    INT          NOT NULL REFERENCES locations(id),
  sub_location   VARCHAR(255),
  qty_found      INT,
  qty_needed     INT,
  notes          TEXT,
  qty_available  INT,
  low_stock_threshold INT,
  project_id     INT          REFERENCES projects(id)
);

CREATE TABLE item_transactions (
  id           SERIAL PRIMARY KEY,
  item_id      INT       NOT NULL REFERENCES items(id),
  user_id      INT       NOT NULL REFERENCES users(id),
  project_id   INT       REFERENCES projects(id),
  action       action    NOT NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  status       transaction_status  NOT NULL DEFAULT 'active',
  qty          INT       NOT NULL DEFAULT 1,
  notes        TEXT,
  cancelled_at TIMESTAMP,
  cancelled_by INT       REFERENCES users(id),
  -- transfer: recipient of a 'transfer' row, and the link tying the borrows a
  -- transfer creates back to it (so a transfer can be undone cleanly)
  to_user_id   INT       REFERENCES users(id),
  source_tx_id INT       REFERENCES item_transactions(id)
);
