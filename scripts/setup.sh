#!/usr/bin/env bash
#
# First-time provisioning for a fresh Ubuntu host. Installs and configures
# everything the API needs, then starts it: swap, Node, PostgreSQL, nginx, the
# database and its role, the .env, dependencies, build, migrations, the systemd
# service and the nginx reverse proxy.
#
# Run it once, from the repository root, on the target server:
#   ./scripts/setup.sh
#
# It is idempotent: re-running skips whatever is already in place. Database and
# JWT secrets are generated on the host and written only to .env (never printed).
#
# Environment overrides:
#   DB_NAME       database name        (default: inventory)
#   DB_USER       database role        (default: inventory)
#   APP_PORT      API port             (default: 3000)
#   SERVER_NAME   nginx server_name    (default: api-inventory.vtecdashboard.com)
#   NODE_MAJOR    Node.js major        (default: 20)
#   SWAP_SIZE     swap file size       (default: 2G)
#
set -euo pipefail

DB_NAME="${DB_NAME:-inventory}"
DB_USER="${DB_USER:-inventory}"
APP_PORT="${APP_PORT:-3000}"
SERVER_NAME="${SERVER_NAME:-api-inventory.vtecdashboard.com}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SWAP_SIZE="${SWAP_SIZE:-2G}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE="inventory-api"

echo "› Provisioning in $APP_DIR (db: $DB_NAME, port: $APP_PORT)"

# --- 1. Swap -----------------------------------------------------------------
if ! sudo swapon --show | grep -q '/swapfile'; then
  echo "› creating ${SWAP_SIZE} swap file"
  sudo fallocate -l "$SWAP_SIZE" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
else
  echo "› swap already present"
fi

# --- 2. System packages ------------------------------------------------------
echo "› installing base packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg

# --- 3. Node.js --------------------------------------------------------------
if ! command -v node >/dev/null || [ "$(node -v | sed -E 's/v([0-9]+).*/\1/')" != "$NODE_MAJOR" ]; then
  echo "› installing Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "› Node.js $(node -v) already installed"
fi

# --- 4. PostgreSQL & nginx ---------------------------------------------------
echo "› installing PostgreSQL and nginx"
sudo apt-get install -y postgresql nginx
sudo systemctl enable --now postgresql

# --- 5. Secrets & .env -------------------------------------------------------
# Generate secrets on the first run only; a re-run keeps the existing .env.
if [ ! -f "$APP_DIR/.env" ]; then
  echo "› generating .env with fresh secrets"
  ( umask 077; cat > "$APP_DIR/.env" <<EOF
PORT=${APP_PORT}

DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=$(openssl rand -hex 24)

JWT_SECRET=$(openssl rand -hex 32)

COGNITO_REGION=eu-central-1
COGNITO_USER_POOL_ID=eu-central-1_6GUhKxiDm
COGNITO_CLIENT_ID=19hf1ddteog5peadgjvjkt2vn9

CORS_ORIGINS=https://internal.vtecdashboard.com,https://dev-internal.vtecdashboard.com
EOF
  )
else
  echo "› .env already present, reusing it"
fi

# Load the connection settings (fresh or existing) for the steps below.
set -a; . "$APP_DIR/.env"; set +a

# --- 6. Database role & database ---------------------------------------------
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  echo "› creating database role ${DB_USER}"
  sudo -u postgres psql -c "CREATE ROLE \"${DB_USER}\" LOGIN PASSWORD '${DB_PASSWORD}';"
else
  echo "› role ${DB_USER} already exists"
fi

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "› creating database ${DB_NAME}"
  sudo -u postgres createdb -O "${DB_USER}" "${DB_NAME}"
else
  echo "› database ${DB_NAME} already exists"
fi

# --- 7. Dependencies, build, migrations --------------------------------------
echo "› installing dependencies"
( cd "$APP_DIR" && npm install --no-audit --no-fund )

echo "› building"
( cd "$APP_DIR" && npm run build )

echo "› running migrations"
( cd "$APP_DIR/database" \
  && PGHOST="$DB_HOST" PGUSER="$DB_USER" PGPASSWORD="$DB_PASSWORD" ./migrate.sh "$DB_NAME" )

# --- 8. systemd service ------------------------------------------------------
echo "› installing systemd service ${SERVICE}"
sudo tee "/etc/systemd/system/${SERVICE}.service" >/dev/null <<EOF
[Unit]
Description=Inventory Backend API (NestJS)
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE}"
sudo systemctl restart "${SERVICE}"

# --- 9. nginx reverse proxy --------------------------------------------------
echo "› configuring nginx reverse proxy"
sudo tee "/etc/nginx/sites-available/${SERVICE}" >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAME};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
sudo ln -sf "/etc/nginx/sites-available/${SERVICE}" "/etc/nginx/sites-enabled/${SERVICE}"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

# --- Done --------------------------------------------------------------------
sleep 2
echo
echo "Setup complete."
echo "  service : $(systemctl is-active "${SERVICE}")"
echo "  health  : $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${APP_PORT}/health")"
echo
echo "Next: point ${SERVER_NAME} at this host, then enable HTTPS with:"
echo "  sudo certbot --nginx -d ${SERVER_NAME}"
