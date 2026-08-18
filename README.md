# Inventory Backend API

REST API for VTEC's inventory and equipment management, with role-based access
control. Built with [NestJS](https://nestjs.com/) and PostgreSQL.

## Features

- **Inventory** — items with quantities, locations, sub-locations, categories,
  and optional equipment-registry details (serial number, manufacturer, owner,
  calibration, maintenance, training, purchase/service dates).
- **Item actions** — take, borrow, return, breakdown and transfer between users,
  with partial quantities supported.
- **Projects** — assign items to a project and release them (all or selected).
- **Transaction history** — every action is recorded and queryable, with
  pagination and filtering.
- **Alerts** — low-stock and calibration-due flags, each with a count endpoint.
- **Import / export** — bulk create/update from CSV or Excel, covering every
  column, and export to the same formats.
- **Role-based access** — `admin`, `manager` and `employee` roles enforced
  server-side (employees see their own data; managers and admins see all).

## Tech stack

- NestJS (controllers, services, guards, DTO validation with `class-validator`)
- PostgreSQL via `node-postgres` (`pg`)
- Versioned SQL migrations with a tracked `schema_migrations` table
- Jest for unit and end-to-end tests

## Project structure

```
src/
  auth/          Authentication, guards, roles, current-user decorator
  database/      PostgreSQL connection + query helpers
  inventory/     Items, locations, categories, actions, import/export
  projects/      Project assignment and release
  transactions/  Transaction history
  users/         User directory and holdings
database/
  create.sql     Full schema snapshot
  migrations/    Versioned migrations (NNNN_*.sql)
  migrate.sh     Migration runner
  test-seed.sql  Seed data for the test database
test/            End-to-end tests
```

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 14+

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
# then edit .env with your database credentials
```

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port | `3000` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_NAME` | Database name | `vtec_dashboard` |
| `DB_USER` | Database user | — |
| `DB_PASSWORD` | Database password | — |
| `JWT_SECRET` | JWT signing secret (temporary auth) | — |

### 3. Create the database and run migrations

```bash
createdb vtec_dashboard
cd database && ./migrate.sh vtec_dashboard
```

### 4. Run the API

```bash
npm run start:dev     # watch mode
npm run start:prod    # production (after npm run build)
```

The API listens on `http://localhost:$PORT`.

## Tests

```bash
npm test          # unit tests
npm run test:e2e  # end-to-end tests
```

## Migrations

Add a new change as `database/migrations/NNNN_description.sql` (4-digit,
incrementing), then run `./migrate.sh <database>`. Applied migrations are
recorded and never run twice.
