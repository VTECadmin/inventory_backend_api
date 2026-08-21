#!/usr/bin/env bash
#
# Sets up the API for local development: installs dependencies, creates a local
# .env with sensible defaults, creates the database and runs migrations. Assumes
# Node.js and a running local PostgreSQL are already installed (for a server,
# use setup.sh instead, which installs those too).
#
# Run once from the repository root:
#   ./scripts/setup-local.sh
#
# It is idempotent: re-running keeps an existing .env and skips an existing
# database.
#
# Environment overrides:
#   DB_NAME   database name   (default: vtec_dashboard)
#   DB_USER   database user   (default: current OS user)
#
set -euo pipefail

DB_NAME="${DB_NAME:-vtec_dashboard}"
DB_USER="${DB_USER:-$(whoami)}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

command -v node >/dev/null || { echo "Node.js is required (https://nodejs.org)"; exit 1; }
command -v psql >/dev/null || { echo "A running local PostgreSQL is required"; exit 1; }

echo "› installing dependencies"
( cd "$APP_DIR" && npm install --no-audit --no-fund )

if [ ! -f "$APP_DIR/.env" ]; then
  echo "› creating .env for local development"
  cat > "$APP_DIR/.env" <<EOF
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=

JWT_SECRET=$(openssl rand -hex 32)

COGNITO_REGION=eu-central-1
COGNITO_USER_POOL_ID=eu-central-1_6GUhKxiDm
COGNITO_CLIENT_ID=19hf1ddteog5peadgjvjkt2vn9

CORS_ORIGINS=http://localhost:4200,http://localhost:4300
EOF
else
  echo "› .env already present, keeping it"
fi

set -a; . "$APP_DIR/.env"; set +a

if ! psql -lqt | cut -d '|' -f1 | grep -qw "$DB_NAME"; then
  echo "› creating database ${DB_NAME}"
  createdb "$DB_NAME"
else
  echo "› database ${DB_NAME} already exists"
fi

echo "› running migrations"
( cd "$APP_DIR/database" \
  && PGHOST="$DB_HOST" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" ./migrate.sh "$DB_NAME" )

echo
echo "Done. Start the API with:  npm run start:dev"
