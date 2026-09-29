#!/bin/sh
# Executado pelo entrypoint do Postgres SOMENTE na primeira inicialização
# (quando o volume postgres_data está vazio).
#
# - POSTGRES_DB (= POSTGRES_N8N_DB) já é criado pelo entrypoint: banco interno do n8n.
# - Aqui criamos o banco da aplicação e habilitamos pgvector nele.
set -eu

APP_DB="${POSTGRES_APP_DB:-pipedesign}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v app_db="$APP_DB" <<'SQL'
SELECT format('CREATE DATABASE %I', :'app_db')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'app_db')\gexec
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$APP_DB" <<'SQL'
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

echo "Banco da aplicação '$APP_DB' pronto (extensões: vector, pgcrypto)."
