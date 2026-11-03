#!/usr/bin/env bash
# Junta as migrações em um único arquivo para colar no SQL Editor do Supabase.
cd "$(dirname "$0")/.."
{ echo "-- Arquivo gerado por dev/combine.sh a partir de supabase/migrations. Cole tudo no SQL Editor de um projeto NOVO e clique em Run."; for f in supabase/migrations/*.sql; do echo; echo "-- >>> $f"; cat "$f"; done; } > supabase/setup/banco-completo.sql
echo "ok: supabase/setup/banco-completo.sql"
