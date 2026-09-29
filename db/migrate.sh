#!/usr/bin/env bash
# Aplica db/migrations/*.sql no banco da aplicação (pipedesign).
# O script em db/init/ só roda na primeira criação do volume do Postgres.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

USER="${POSTGRES_USER:?defina POSTGRES_USER no .env}"
DB="${POSTGRES_APP_DB:-pipedesign}"

echo "Aplicando migrations em $DB (usuário $USER)..."
for f in db/migrations/*.sql; do
  echo "  $f"
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$USER" -d "$DB" < "$f"
done
echo "OK."
