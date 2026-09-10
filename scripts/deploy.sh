#!/usr/bin/env bash
#
# Deploys a committed revision of the backend to the EC2 host: exports the tree
# with git archive, extracts it over the app directory (keeping .env and
# node_modules), installs dependencies, builds, runs pending migrations, and
# restarts the systemd service.
#
# There are two environments on the SAME EC2, each a separate app directory +
# systemd service + .env (its own database, Cognito pool and port):
#   dev  -> ~/inventory_backend_api       , service inventory-api
#   prod -> ~/inventory_backend_api-prod  , service inventory-api-prod
# The .env is NOT shipped (it is gitignored); it must already exist in the target
# directory on the server, with that environment's values.
#
# Usage:
#   ./scripts/deploy.sh [dev|prod] [git-ref]   # env defaults to dev, ref to HEAD
#   ./scripts/deploy.sh                         # dev, HEAD
#   ./scripts/deploy.sh prod                    # prod, HEAD
#   ./scripts/deploy.sh dev <commit>            # roll dev back to a commit
#
# Environment overrides:
#   HOST   SSH target        (default: ubuntu@52.29.106.32)
#   KEY    SSH private key   (default: ~/.ssh/inventory_server.pem)
#
set -euo pipefail

ENV="${1:-dev}"
REF="${2:-HEAD}"
HOST="${HOST:-ubuntu@52.29.106.32}"
KEY="${KEY:-$HOME/.ssh/inventory_server.pem}"

case "$ENV" in
  dev)  APP_DIR="inventory_backend_api";      SERVICE="inventory-api" ;;
  prod) APP_DIR="inventory_backend_api-prod"; SERVICE="inventory-api-prod" ;;
  *) echo "Unknown environment '$ENV' (use 'dev' or 'prod')" >&2; exit 1 ;;
esac

echo "Deploying '$REF' to $ENV ($SERVICE) on $HOST ..."

# The tar stream is the ssh command's stdin (consumed by `tar -x`), so the build
# steps run as the remote command itself. $APP_DIR and $SERVICE expand locally
# (chosen above); \$DB_* are escaped to expand on the server, after sourcing .env.
git archive --format=tar --prefix="$APP_DIR/" "$REF" \
  | ssh -i "$KEY" "$HOST" "
set -euo pipefail
tar -x -C ~/
cd ~/$APP_DIR

echo '› installing dependencies'
npm install --no-audit --no-fund

echo '› building'
npm run build

echo '› running migrations'
set -a; . ./.env; set +a
( cd database && PGHOST=\"\$DB_HOST\" PGUSER=\"\$DB_USER\" PGPASSWORD=\"\$DB_PASSWORD\" ./migrate.sh \"\$DB_NAME\" )

echo '› restarting service'
sudo systemctl restart $SERVICE
sleep 2
systemctl is-active $SERVICE
"

echo "Done."
