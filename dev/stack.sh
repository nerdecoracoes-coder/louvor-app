#!/usr/bin/env bash
# Ambiente local para desenvolvimento e testes: Postgres 16 + Supabase Auth (GoTrue) + PostgREST.
# Reproduz as peças do Supabase que o app usa (login, banco com RLS e API REST), sem Docker.
# Uso: dev/stack.sh start | stop | reset
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BIN="${STACK_BIN:-/tmp/claude-0/stack}"     # onde ficam os binários auth e postgrest
DATA="${STACK_DATA:-/var/tmp/louvor-pgdata}"
PG=/usr/lib/postgresql/16/bin
PORT_PG=54322; PORT_AUTH=9999; PORT_REST=3000
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
export PGHOST=127.0.0.1 PGPORT=$PORT_PG PGUSER=postgres

psqlq() { psql -v ON_ERROR_STOP=1 -q "$@"; }

start_pg() {
  if [ ! -d "$DATA" ]; then
    mkdir -p "$DATA"; chown postgres:postgres "$DATA"
    su postgres -c "$PG/initdb -D $DATA -U postgres --auth=trust -E UTF8 --locale=C.UTF-8" >/dev/null
    echo "listen_addresses='127.0.0.1'" >> "$DATA/postgresql.conf"
    echo "port=$PORT_PG" >> "$DATA/postgresql.conf"
    echo "unix_socket_directories='/tmp'" >> "$DATA/postgresql.conf"
    FRESH=1
  fi
  su postgres -c "$PG/pg_ctl -D $DATA -l $DATA/log.txt -w start" >/dev/null
  if [ "${FRESH:-0}" = 1 ]; then
    psqlq -f "$HERE/supabase_roles.sql"
  fi
}

start_auth() {
  GOTRUE_DB_DRIVER=postgres \
  DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:$PORT_PG/postgres?sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" \
  API_EXTERNAL_URL="http://127.0.0.1:$PORT_AUTH" GOTRUE_SITE_URL="http://127.0.0.1:8080" \
  GOTRUE_API_HOST=127.0.0.1 PORT=$PORT_AUTH \
  GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_DISABLE_SIGNUP=false GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_LOG_LEVEL=warn \
  nohup "$BIN/auth" > /tmp/claude-0/auth.log 2>&1 &
  for i in $(seq 1 40); do curl -s "http://127.0.0.1:$PORT_AUTH/health" >/dev/null && break; sleep 0.25; done
}

apply_migrations() {
  for f in "$ROOT"/supabase/migrations/*.sql; do psqlq -f "$f"; done
}

start_rest() {
  cat > /tmp/claude-0/postgrest.conf <<EOF
db-uri = "postgres://authenticator:postgres@127.0.0.1:$PORT_PG/postgres"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-host = "127.0.0.1"
server-port = $PORT_REST
db-max-rows = 1000
EOF
  nohup "$BIN/postgrest" /tmp/claude-0/postgrest.conf > /tmp/claude-0/rest.log 2>&1 &
  for i in $(seq 1 40); do curl -s "http://127.0.0.1:$PORT_REST/" >/dev/null && break; sleep 0.25; done
}

stop_all() {
  pkill -f "$BIN/postgrest" 2>/dev/null || true
  pkill -f "$BIN/auth" 2>/dev/null || true
  [ -d "$DATA" ] && su postgres -c "$PG/pg_ctl -D $DATA -m fast stop" >/dev/null 2>&1 || true
}

case "${1:-start}" in
  start) start_pg; start_auth; if [ "${FRESH:-0}" = 1 ]; then apply_migrations; psqlq -f "$HERE/seed_local.sql" 2>/dev/null || true; fi; start_rest; echo "stack ok: pg:$PORT_PG auth:$PORT_AUTH rest:$PORT_REST";;
  stop) stop_all;;
  reset) stop_all; rm -rf "$DATA"; "$0" start;;
  migrate) apply_migrations; pkill -USR1 -f "$BIN/postgrest" || true;;
esac
