# Project Handover — Inventory & Timesheet Dashboard

A practical guide to pick up this project: what it is, how it's built, how to run
it on your machine and how it's deployed. Read this once
top-to-bottom, then use it as a reference.

---

## 1. What this is

An **inventory & equipment management** tool with **role-based access control**,
plus an **attendance / timesheet analytics** module. It's delivered as a set of
pages inside VTEC's internal Angular dashboard, backed by a dedicated REST API.

- **Frontend** — Angular 17, part of the `vtec_internal_webpage` dashboard
  (the Inventory, Item detail, My Borrows, History, Users, Projects and Timesheet
  pages).
- **Backend** — NestJS + PostgreSQL REST API (`inventory_backend_api`).
- **Identity** — AWS Cognito. Users log in with their company account; their
  Cognito **group** decides their role. RBAC is enforced at the API, not just in
  the UI.
- **Two environments** — `dev` and `prod`, on one EC2, each with its own DB and
  Cognito pool.

```
Browser ──HTTPS──▶ nginx ──┬─▶ Node API dev  (:3000) ─▶ PostgreSQL "inventory"
                           └─▶ Node API prod (:3001) ─▶ PostgreSQL "inventory_prod"
Frontend (Angular) ──JWT──▶ the matching API      Identity: AWS Cognito
```

---

## 2. Repositories, branches, access

| Repo                      | Where                                     | What                                  |
| ------------------------- | ----------------------------------------- | ------------------------------------- |
| `inventory_backend_api` | GitHub`VTECadmin/inventory_backend_api` | The REST API (this repo)              |
| `vtec_internal_webpage` | AWS CodeCommit (eu-central-1)             | The company dashboard incl. our pages |

**Access you'll need:** GitHub (backend), AWS account with CodeCommit + Amplify +
Cognito + EC2 (frontend, deploys, identity), and the EC2 SSH key
(`inventory_server.pem`) for backend deploys. Ask the Arun for
whatever you don't have yet.

**Branches**

- **Backend:** work on `main`.
- **Frontend:** `dev` is what Amplify builds for the **dev** site; the **prod**
  site is built from the prod branch. Feature work
  was done on `inventory_timesheet` and merged into `dev`.

---

## 3. Run it locally

### 3.1 Prerequisites

- **Node 18+ (LTS)** and npm.
- **PostgreSQL** running locally.
- Angular CLI is used via `npx` (no global install needed).

### 3.2 Backend

```bash
cd inventory_backend_api
cp .env.example .env          # then edit .env (see below)
./scripts/setup-local.sh      # creates the DB + role and runs migrations (one-off)
npm install
npm run start:dev             # API on http://localhost:3000  (watch mode)
npm test                      # unit tests (should be all green)
```

Key `.env` values (all documented in `.env.example`):

- `PORT=3000`, `DB_*` for your local Postgres.
- **Cognito** — `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`
  must match the environment you point the frontend at, or every request 401s.
  The dev pool values are in `.env.example`.
- `ALLOW_LOCAL_LOGIN` / `LOCAL_NO_AUTH` — local-only auth shortcuts, see §5.

The DB schema lives in `database/migrations/` (numbered SQL, applied by
`migrate.sh` / `setup.sh`). An up-to-date entity-relationship diagram is in
[`docs/schema.dbml`](docs/schema.dbml) — paste it into [https://dbdiagram.io/d](https://dbdiagram.io/d)
to view it.

### 3.3 Frontend

```bash
cd vtec_internal_webpage
npm install
npm start                     # ng serve → http://localhost:4200
```

- `src/environments/environment.ts` points the app at the **dev** API
  (`dev-api-vtec-inventory.vtecdashboard.com`), with a localhost fallback for the
  dev server. `environment.prod.ts` points at the prod API.
- Our pages are under `src/app/pages/` (`inventory`, `item-detail`, `my-borrows`,
  `history`, `users`, `projects`, `timesheet`, plus `shared/` and `services/`).

---

## 4. How authentication & roles work

- Users authenticate against the **AWS Cognito** user pool; the frontend sends the
  Cognito **JWT** on every API call.
- The backend maps Cognito **groups** to an app role:
  - group `Admin` → **admin**
  - group `InventoryManager` → **manager**
  - anything else → **employee**
- Every endpoint is guarded by the required role (`@Roles(...)` + `RolesGuard`), so
  RBAC is enforced server-side. See the role-access mapping in the requirements doc.

**Roles in short:**

- **Employee** (any signed-in user): view all inventory, do item actions
  (take/borrow/return/breakdown) and transfers, see their own history.
- **Manager** (`InventoryManager`): all of the above + manage inventory
  (add/edit/delete, import/export, projects, bulk), the Users directory, full
  history.
- **Admin**: everything, incl. viewing another user's current holdings.

---

## 5. ⚠️ The two local-only auth bypasses (NEVER commit)

To develop without a real Cognito login, two shortcuts exist. They are
**uncommitted, local-only, and must never be pushed or deployed** (the deploy uses
`git archive`, which only ships committed content, so they can't leak — keep it
that way):

- **Backend** — `src/auth/jwt-auth.guard.ts`: with `LOCAL_NO_AUTH=1` it injects a
  fake admin user and skips Cognito.
- **Frontend** — `src/app/services/data-store.service.ts`: seeds a fake logged-in
  user with every role so pages render without a login.

Use them for local preview; revert (`git restore <file>`) before committing.

---

## 6. Deployment

### Backend (from your machine, over SSH)

```bash
./scripts/deploy.sh dev       # → inventory-api service, port 3000
./scripts/deploy.sh prod      # → inventory-api-prod service, port 3001
```

It exports the committed `HEAD` with `git archive`, ships it to the EC2
(`ubuntu@52.29.106.32`, key `~/.ssh/inventory_server.pem`), installs, builds, runs
pending migrations, and restarts the target service. Health check:
`https://dev-api-vtec-inventory.vtecdashboard.com/health` (and `api-vtec-inventory…`
for prod) → `{"status":"ok","db":"up"}`.

### Frontend (AWS Amplify)

Amplify builds the dashboard from the branch:

- push/merge to **`dev`** → the **dev** site rebuilds automatically.
- the **prod** release is a merge to the prod branch (**mentor's call / auth**).

The `docs`, `README.md` and `.env.example` in the backend repo document the server
setup (`setup.sh`), HTTPS (Let's Encrypt/certbot), systemd services, backups, etc.

---

## 7. Feature tour

- **Inventory** — list with filters (location, category, low-stock,
  calibration-due, borrowed), search, sort, pagination; item detail; actions
  (take/borrow/return/breakdown); **two-step transfers** (propose → recipient
  accepts/declines; per-user auto-accept); project assignment; **archive**
  (soft-delete); CSV/Excel import & export; per-item low-stock threshold and
  calibration-due alerts; optional equipment-registry fields.
- **History** — role-scoped movement log (employees see their own; managers/admins
  see all), with undo of your own actions and CSV export. An **item's** detail page
  shows that item's **full** movement history (all users).
- **Users** — the Cognito-backed directory (admin/manager), plus a minimal
  transfer-recipient directory any user can read.
- **Timesheet** — 100% client-side: upload an attendance CSV and get an analysis
  (hours deficit/excess vs a target, weekly balance, absence/work-type totals,
  block-hours donut + GitHub-style calendar, incomplete-day correction). Nothing is
  sent to the server.

---

## 8. What's done vs. what's left

**Done:** full feature set above, deployed and live on **dev** (backend + frontend);
backend also deployed to **prod** and healthy; tests green; data model documented.

**Left to do:**

1. **Release the frontend to prod**. The **prod backend is already ready.**
2. **Populate `inventory_prod`** — the prod DB is currently **empty** (import the
   real inventory CSV/Excel, or copy from dev).
3. **Schedule DB backups** — `scripts/backup-db.sh` is ready; add a cron for both
   `inventory` and `inventory_prod`.

---

## 9. Command cheat sheet

```bash
# Backend
npm run start:dev          # run locally (watch)
npm test                   # unit tests
npm run test:e2e           # e2e tests (needs a test DB)
./scripts/deploy.sh dev    # deploy to dev
./scripts/deploy.sh prod   # deploy to prod

# Frontend
npm start                  # ng serve (localhost:4200)
npm run build              # production build
npm test                   # karma (use --browsers=ChromeHeadlessCI in CI/containers)

# Server (SSH)
ssh -i ~/.ssh/inventory_server.pem ubuntu@52.29.106.32
sudo systemctl status inventory-api        # dev service
sudo systemctl status inventory-api-prod   # prod service
journalctl -u inventory-api -f             # live logs
```

---

## 10. Where to find more

- **`README.md`** (backend) — features, API reference, migrations, auth, security,
  full server/ops setup.
- **`docs/schema.dbml`** — the relational schema (render on dbdiagram.io).
- **Requirements & Role-Access Mapping** doc — the business requirements, the exact role-access table, architecture and limitations.
- **`.env.example`** — every environment variable, with the dev/prod split.
