#!/usr/bin/env bash
# Pushes pending Supabase migrations directly via a Postgres connection
# string, deliberately skipping `supabase link`. As of Supabase CLI 2.112.0,
# `link` calls the platform's project API-keys endpoint and its response
# fails the CLI's own schema validation (SchemaError on `inserted_at`),
# turning every migration/deploy into "failed to get api keys" even though
# nothing about the project itself is broken. `db push --db-url` talks to
# Postgres directly and never touches that endpoint.
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

encoded_password=$(python3 -c "import os,urllib.parse;print(urllib.parse.quote(os.environ['SUPABASE_DB_PASSWORD'], safe=''))")
db_url="postgresql://postgres:${encoded_password}@db.${SUPABASE_PROJECT_REF}.supabase.co:5432/postgres"

npx -y supabase@2 db push --include-all --db-url "$db_url"
