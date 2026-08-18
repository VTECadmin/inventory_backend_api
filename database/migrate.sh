#!/usr/bin/env bash
#
# Versioned migration runner.
#
# Applies every migrations/NNNN_*.sql that has not been applied yet, in order,
# each inside a single transaction, and records it in the schema_migrations
# table so it is never applied twice.
#
# Usage:  ./migrate.sh [database]      (default: vtec_dashboard)
#
set -euo pipefail

DB="${1:-vtec_dashboard}"
DIR="$(cd "$(dirname "$0")" && pwd)/migrations"

# Tracking table: which migration versions have already run.
psql -d "$DB" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS schema_migrations (
     version    TEXT PRIMARY KEY,
     applied_at TIMESTAMP NOT NULL DEFAULT now()
   );"

applied=0
for file in "$DIR"/*.sql; do
  version="$(basename "$file" .sql)"
  exists="$(psql -d "$DB" -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'")"
  if [ "$exists" = "1" ]; then
    echo "• skip   $version (already applied)"
    continue
  fi
  echo "• apply  $version"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q --single-transaction -f "$file"
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO schema_migrations (version) VALUES ('$version');"
  applied=$((applied + 1))
done

echo "Done — $applied migration(s) applied to \"$DB\"."
