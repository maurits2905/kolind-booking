#!/usr/bin/env bash
# Runs supabase/setup.sql twice against a throwaway local database and then
# the security/business-rule tests in dev/test.sql.
#
# Everything runs twice: once with the classic Supabase defaults (new tables
# automatically granted to anon/authenticated) and once with the stricter
# defaults new projects get from 30 May 2026 (no automatic grants). setup.sql
# grants explicitly, so both must pass.
#
# Needs a local Postgres 15+ with btree_gist; set PGHOST/PGPORT/PGUSER as usual.
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
cd "$(dirname "$0")/.."
DB="${TEST_DB:-kolind_test}"

for mode in classic strict; do
  echo "== $mode Supabase defaults =="
  dropdb --if-exists "$DB" >/dev/null
  createdb "$DB"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f dev/supabase-stub.sql >/dev/null
  if [ "$mode" = strict ]; then
    psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "
      alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
      alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;" >/dev/null
  fi
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql >/dev/null 2>&1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/setup.sql >/dev/null 2>&1
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f dev/test.sql 2>&1 | sed 's/^psql:[^ ]* WARNING:  //'
done
