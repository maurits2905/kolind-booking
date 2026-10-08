#!/usr/bin/env bash
# (Re)creates the local database used by local-supabase.mjs, with demo data.
set -euo pipefail
cd "$(dirname "$0")/.."
export PGOPTIONS="-c client_min_messages=warning"
DB="${PGDATABASE:-kolind_dev}"
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f dev/supabase-stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql
rm -rf dev/.storage
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f dev/seed-local.sql
echo "Database $DB klar. Demo-login: anne@familien.dk (admin) / carl@familien.dk (familie), kode: ferie2026"
