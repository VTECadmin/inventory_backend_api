#!/usr/bin/env bash
#
# Deploys a committed revision of the backend to the EC2 host: exports the tree
# with git archive, extracts it over the app directory (keeping .env and
# node_modules), installs dependencies, builds, runs pending migrations, and
# restarts the systemd service.
#
# Usage:
#   ./scripts/deploy.sh [git-ref]        # defaults to HEAD
#
# Environment overrides:
#   HOST   SSH target        (default: ubuntu@52.29.106.32)
#   KEY    SSH private key   (default: ~/.ssh/inventory_server.pem)
#
set -euo pipefail

REF="${1:-HEAD}"
HOST="${HOST:-ubuntu@52.29.106.32}"
KEY="${KEY:-$HOME/.ssh/inventory_server.pem}"
APP_DIR="inventory_backend_api"

echo "Deploying '$REF' to $HOST ..."

# The tar stream is the ssh command's stdin (consumed by `tar -x`), so the build
# steps run as the remote command itself. Remote-evaluated variables are escaped
# (\$) so they expand on the server, after sourcing .env.
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
sudo systemctl restart inventory-api
sleep 2
systemctl is-active inventory-api
"

echo "Done."
