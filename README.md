# Inventory Backend API

REST API for VTEC's inventory and equipment management, with role-based access
control. Built with [NestJS](https://nestjs.com/) and PostgreSQL.

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Getting started](#getting-started)
- [Tests](#tests)
- [Migrations](#migrations)
- [Authentication & authorization](#authentication--authorization)
- [API reference](#api-reference)
- [Security](#security)
- [Operations](#operations)

## Features

- **Inventory** — items with quantities, locations, sub-locations, categories,
  and optional equipment-registry details (serial number, manufacturer, owner,
  calibration, maintenance, training, purchase/service dates). Extended search
  (name, part id, category, sub-location, description), column sorting, and pagination.
- **Item actions** — take, borrow, return, breakdown, with partial quantities.
- **Transfers (two-step handshake)** — the sender *proposes* a transfer; the item
  stays with them until the **recipient accepts** (or declines). Each user has an
  **auto-accept** preference (finalizes incoming transfers immediately) and may
  attach an optional **message**.
- **Archive (soft-delete)** — deleting an item marks it `deleted_at` and hides it
  from the active list while keeping its history; acquiring actions reject archived
  items. Same soft-delete for projects.
- **Projects** — assign items (single or **bulk**), release them (all or selected),
  rename, mark complete/reopen (completing releases the items), and soft-delete.
- **Bulk actions** — assign-to-project / release / delete over a validated,
  size-capped list of item ids.
- **Transaction history** — every action is recorded and queryable, with
  pagination and filtering; users can undo their own recent actions.
- **Alerts** — low-stock and calibration-due flags, each with a count endpoint.
- **Import / export** — bulk create/update from CSV or Excel, covering every
  column, and export to the same formats (export honors the same search as the list).
- **Users** — a directory sourced from the Cognito pool (with graceful fallback),
  plus `/auth/me` for the signed-in user's profile.
- **Role-based access** — `admin`, `manager` and `employee` roles enforced
  server-side (employees see their own data; managers and admins see all).
- **Production hardening** — Cognito-only auth by default (local login opt-in),
  request rate limiting, security headers, and startup config validation.

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

This section runs the API for **local development** on your own machine — the
[`setup-local.sh`](#quick-start) script does it in one command (see Quick start
below), or follow the manual steps. To provision a **server** instead, use
[`setup.sh`](#first-time-server-setup), which does the same plus installs Node,
PostgreSQL, nginx and the systemd service.

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ (installed and running locally)

### Quick start

```bash
./scripts/setup-local.sh   # installs deps, creates .env + database, runs migrations
npm run start:dev
```

`setup-local.sh` is idempotent (it keeps an existing `.env` and database). The
steps below describe what it does, in case you prefer to configure things by
hand.

### Manual setup

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure the environment

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
| `JWT_SECRET` | Signing secret for the local JWT fallback | — |
| `COGNITO_REGION` | Region of the Cognito user pool | `eu-central-1` |
| `COGNITO_USER_POOL_ID` | Cognito user pool that issues the tokens | `eu-central-1_6GUhKxiDm` |
| `COGNITO_CLIENT_ID` | Expected token audience (Cognito app client) | `19hf1ddteog5peadgjvjkt2vn9` |
| `CORS_ORIGINS` | Comma-separated list of allowed browser origins | dashboard + `localhost` dev ports |

#### 3. Create the database and run migrations

```bash
createdb vtec_dashboard
cd database && ./migrate.sh vtec_dashboard
```

#### 4. Run the API

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

A migration is a versioned SQL script that changes the database structure (a new
table, a new column…), so the schema evolves in a tracked, reproducible way
instead of by hand.

To make a schema change, add `database/migrations/NNNN_description.sql` (4-digit,
incrementing) and run `./migrate.sh <database>`. Applied migrations are recorded
in the `schema_migrations` table and never run twice — so `setup.sh` and
`deploy.sh` apply any pending ones automatically and safely on every run.

An up-to-date entity-relationship view of the schema (generated from the
migrations) lives in [`docs/schema.dbml`](docs/schema.dbml) — paste it into
[dbdiagram.io](https://dbdiagram.io/d) to render or export it. Keep it in sync
when a migration changes the schema.

## Authentication & authorization

The API authenticates callers from a bearer token and authorizes them by role.

### Cognito (production)

Requests carry a Cognito access token (`Authorization: Bearer <token>`). The API
validates each token against the user pool's public keys (JWKS), checking the
signature, the issuer (`COGNITO_USER_POOL_ID`) and the audience
(`COGNITO_CLIENT_ID`). No secret is shared with Cognito — validation relies only
on the published public keys.

**Group-to-role mapping** — a user's Cognito groups are mapped to an application
role; when a user is in several groups the strongest role wins:

| Cognito group | Application role |
| --- | --- |
| `Admin` | `admin` |
| `InventoryManager` | `manager` |
| _(any other group, or none)_ | `employee` |

**Just-in-time provisioning** — on first sign-in a user is linked to a local
record by Cognito `sub`, or by email (back-filling the `cognito_sub` column), or
created automatically. No manual account setup is required. The link is stored in
`users.cognito_sub` (migration `0004_cognito_identity`).

### Local JWT fallback (development)

`POST /auth/login` issues a JWT signed with `JWT_SECRET`, accepted alongside
Cognito tokens. It exists for local development and tests; production uses
Cognito.

### Role-based access control

Routes are protected by a guard that accepts either token type, and authorization
is enforced **server-side**: employees only ever see their own data, while
managers and admins see everything. Restricting the UI is not relied upon — the
rules live in the API and are covered by the end-to-end test suite.

## API reference

All routes require a bearer token unless marked **Public**. "Authenticated" means
any signed-in user; employees are scoped to their own data.

**Auth & health**

| Method | Route | Access |
| --- | --- | --- |
| `POST` | `/auth/login` | Public — rate-limited; local JWT login is opt-in (`ALLOW_LOCAL_LOGIN=1`) |
| `GET` | `/auth/me` | Authenticated — the signed-in user's profile |
| `GET` | `/health` | Public |

**Inventory** — `/inventory`

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/inventory` (query: `location`, `search`, `sort`, `order`, `lowStock`, `calibrationDue`, `borrowed`, `page`, `limit`) | Authenticated |
| `GET` | `/inventory/:id` | Authenticated |
| `GET` | `/inventory/locations`, `/categories` | Authenticated |
| `GET` | `/inventory/low-stock/count`, `/calibration-due/count`, `/borrowed/count` | Authenticated |
| `POST` | `/inventory/:id/take`, `/borrow`, `/return`, `/breakdown`, `/transfer` | Authenticated |
| `GET` | `/inventory/transfers/pending` | Authenticated (recipient) |
| `POST` | `/inventory/transfers/:id/accept`, `/decline` | Authenticated (recipient) |
| `GET` `PATCH` | `/inventory/transfers/auto-accept` | Authenticated |
| `POST` | `/inventory` (create), `/import` · `GET /inventory/export` | admin · manager |
| `PATCH` `DELETE` | `/inventory/:id` (`DELETE` = archive / soft-delete) | admin · manager |
| `POST` `DELETE` | `/inventory/locations`, `/categories` (manage) | admin · manager |
| `POST` | `/inventory/:id/assign`, `/release` | admin · manager |
| `POST` | `/inventory/bulk/assign-project`, `/release-project`, `/delete` | admin · manager |

**Transactions** — `/transactions`

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/transactions`, `/transactions/export` | Authenticated |
| `GET` | `/transactions/my-borrows` | Authenticated |
| `POST` | `/transactions/:id/undo` | Authenticated |
| `GET` | `/transactions/holdings/:userId` | admin |

**Projects** — `/projects`

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/projects`, `/projects/:id/items` | Authenticated |
| `POST` | `/projects`, `/:id/release`, `/:id/release-all` | admin · manager |
| `PATCH` | `/projects/:id` (rename), `/:id/status` (complete/reopen) | admin · manager |
| `DELETE` | `/projects/:id` (soft-delete) | admin · manager |

**Users** — `/users`

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/users/directory` | Authenticated |
| `GET` | `/users` | admin |

## Security

- **Secrets** live only in `.env` (git-ignored, `chmod 600`). The database
  password and `JWT_SECRET` are generated on the host by `setup.sh` and are never
  committed, logged or printed. Rotating a secret means editing `.env` and
  restarting the service.
- **Transport** — the API sits behind nginx. Once DNS resolves to the host,
  `certbot --nginx` enables HTTPS (TLS) so tokens and data never travel in clear.
- **CORS** — only the origins listed in `CORS_ORIGINS` may call the API from a
  browser; credentials are allowed for those origins only.
- **SSH** — server access uses a key pair; the private `.pem` key stays in
  `~/.ssh` (`chmod 600`) and is never committed.
- **Database** — the API connects with a dedicated, password-protected role
  (not the `postgres` superuser), scoped to its own database.
- **Least exposure** — only nginx (ports 80/443) faces the network; PostgreSQL
  and the Node process listen on `localhost` only.

## Operations

The API runs on an Ubuntu EC2 instance behind nginx. **Two independent instances
share the one host** — `dev` and `prod` — each its own Node process, database and
Cognito pool:

```
                                 ┌─▶ Node API dev  (127.0.0.1:3000) ─▶ PostgreSQL "inventory"
browser ──HTTPS──▶ nginx (80/443)┤
                                 └─▶ Node API prod (127.0.0.1:3001) ─▶ PostgreSQL "inventory_prod"
```

Hosts: **dev-api-vtec-inventory.vtecdashboard.com** (dev, port 3000) and
**api-vtec-inventory.vtecdashboard.com** (prod, port 3001). The dashboard frontend
calls the API with the user's Cognito token; the same code runs locally against a
local database for development. Everything is env-configurable (port, DB, Cognito
pool, `NODE_ENV`), so one codebase serves both environments — see `.env.example`.

### First-time server setup

On a fresh Ubuntu host, provision everything in one command. Get the repository
onto the server first (clone or copy), then from its root run:

```bash
./scripts/setup.sh
```

It installs and configures the full stack — swap, Node.js, PostgreSQL, nginx,
the database and its role, `.env`, dependencies, build, migrations, the
`inventory-api` systemd service, and the nginx reverse proxy — then starts the
API. It is idempotent, so re-running skips whatever is already in place. Database
and JWT secrets are generated on the host and written only to `.env`.

Common overrides (all optional):

```bash
DB_NAME=inventory DB_USER=inventory APP_PORT=3000 \
SERVER_NAME=api-inventory.vtecdashboard.com ./scripts/setup.sh
```

Once DNS points at the host, enable HTTPS — see the next section.

### HTTPS (TLS certificate)

The API uses a free, auto-renewing **Let's Encrypt** certificate, terminated by
nginx on the instance (there is no load balancer). One-time setup.

Prerequisites: the subdomain resolves to the host, ports 80 and 443 are open, and
`certbot` is installed (`setup.sh` installs it; otherwise
`sudo apt-get install -y certbot python3-certbot-nginx`). The nginx site's
`server_name` must be the domain.

Obtain and install the certificate — certbot edits the nginx config, adds the 443
server block, and sets up the HTTP→HTTPS redirect:

```bash
sudo certbot --nginx -d api-inventory.vtecdashboard.com \
  --agree-tos -m <admin-email> --redirect
```

Renewal is automatic (certbot installs a systemd timer). Verify it:

```bash
systemctl list-timers | grep certbot     # the scheduled renewal
sudo certbot renew --dry-run              # test renewal without hitting rate limits
```

The certificate lives under
`/etc/letsencrypt/live/api-inventory.vtecdashboard.com/` and nginx reloads it
automatically on renewal.

### Deployment

Once the server is set up, `./scripts/deploy.sh [dev|prod] [git-ref]` ships a
committed revision to the EC2 host: it exports the tree with `git archive`,
installs dependencies, builds, runs pending migrations, and restarts the target
environment's systemd service. `dev` (the default) deploys to the `inventory-api`
service; `prod` deploys to `inventory-api-prod` (its own app dir + `.env`).
Because it uses `git archive`, only **committed** content ships — uncommitted
local changes (e.g. any auth bypass) never reach the server.

### Service management

Each environment runs as its own systemd service — `inventory-api` (dev) and
`inventory-api-prod` (prod) — with auto-restart on failure and start on boot. They
shut down gracefully — in-flight requests finish and the database pool closes
before exit, so restarts and deployments drop no requests.

```bash
sudo systemctl restart inventory-api      # dev (also done by deploy.sh dev)
sudo systemctl restart inventory-api-prod # prod (also done by deploy.sh prod)
sudo systemctl status inventory-api       # current state
journalctl -u inventory-api -f            # live logs
```

Liveness is exposed at `GET /health`, which also checks the database and returns
`503` if it is unreachable — suitable for an uptime probe or load-balancer check:

```bash
curl http://127.0.0.1:3000/health        # dev  — {"status":"ok","db":"up"}
curl http://127.0.0.1:3001/health        # prod — {"status":"ok","db":"up"}
```

### Database backups

`./scripts/backup-db.sh` writes a timestamped, gzip-compressed `pg_dump` to
`~/backups` and prunes dumps older than the retention window (14 days by
default). Connection settings come from `.env`.

Schedule it daily on the server with cron:

```bash
crontab -e
# Back up the database every day at 03:00.
0 3 * * * /home/ubuntu/inventory_backend_api/scripts/backup-db.sh >> /home/ubuntu/backups/backup.log 2>&1
```

Override the destination or retention with environment variables, e.g.
`BACKUP_DIR=/mnt/data/backups RETENTION_DAYS=30 ./scripts/backup-db.sh`.

### Restoring

Restore a dump into a fresh database:

```bash
gunzip -c ~/backups/<database>_<timestamp>.sql.gz \
  | psql --host="$DB_HOST" --username="$DB_USER" <database>
```

> Backups live on the same instance as the database, so they survive an
> application mistake (a bad query or migration) but not the loss of the disk
> itself. Copying dumps off-host — for example to an S3 bucket — is the next
> step for durability.

### Troubleshooting

| Symptom | Where to look |
| --- | --- |
| Service won't start / keeps restarting | `journalctl -u inventory-api -e` — usually a bad `.env` value or the database being down |
| `GET /health` returns `503` | PostgreSQL is unreachable: check `systemctl status postgresql` and the `DB_*` values in `.env` |
| Requests return `401` | Missing/expired token, or the token's audience/issuer doesn't match `COGNITO_CLIENT_ID` / `COGNITO_USER_POOL_ID` |
| Browser calls blocked by CORS | The caller's origin is not in `CORS_ORIGINS`; add it and restart the service |
| `502 Bad Gateway` from nginx | The API isn't listening on its port; confirm the service is active |

After changing `.env`, restart the service for the new values to take effect:
`sudo systemctl restart inventory-api`.
