# Database migrations

Versioned, tracked schema changes — so the database can be rebuilt reproducibly
instead of applying SQL by hand.

## How it works

- Each change is a file `migrations/NNNN_description.sql` (4-digit, incrementing).
- `migrate.sh` applies every migration **not yet recorded**, in order, each in a
  single transaction, and records the version in a `schema_migrations` table.
- Running it again is safe: applied migrations are skipped.

## Usage

```bash
# from the database/ folder
./migrate.sh                 # applies pending migrations to vtec_dashboard
./migrate.sh vtec_dashboard_test
```

For a **fresh** database, `0001_baseline.sql` creates the whole schema.

## Adding a change

1. Create the next file, e.g. `0002_add_supplier_to_items.sql`.
2. Write the change (`ALTER TABLE …`, `CREATE TABLE …`, `ALTER TYPE … ADD VALUE …`).
3. Run `./migrate.sh <database>`.

## Notes

- `0001_baseline.sql` is the full current schema. `create.sql` (one level up) is
  kept as a convenience snapshot identical to the baseline.
- An **existing** database that already has the schema should be marked as having
  the baseline applied, so the runner doesn't try to recreate it:

  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT now());
  INSERT INTO schema_migrations (version) VALUES ('0001_baseline') ON CONFLICT DO NOTHING;
  ```
