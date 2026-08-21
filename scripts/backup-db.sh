#!/usr/bin/env bash
#
# Dumps the PostgreSQL database to a timestamped, compressed file and prunes
# backups older than the retention window. Intended to run on the server from
# cron; connection settings are read from the app's .env.
#
# Usage:
#   ./scripts/backup-db.sh
#
# Environment overrides:
#   BACKUP_DIR         destination directory   (default: ~/backups)
#   RETENTION_DAYS     days of backups to keep (default: 14)
#
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

# Load DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD.
set -a; . "$APP_DIR/.env"; set +a

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

echo "› dumping $DB_NAME to $TARGET"
# Dump to a temporary file first so an interrupted run never leaves a partial
# backup that looks complete.
PGPASSWORD="$DB_PASSWORD" pg_dump \
  --host="$DB_HOST" \
  --port="${DB_PORT:-5432}" \
  --username="$DB_USER" \
  --no-owner \
  "$DB_NAME" \
  | gzip > "$TARGET.part"
mv "$TARGET.part" "$TARGET"

echo "› pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f -mtime +"$RETENTION_DAYS" -delete

echo "Done. $(find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -type f | wc -l | tr -d ' ') backup(s) retained."
