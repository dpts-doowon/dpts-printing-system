#!/usr/bin/env bash
# Atualiza para uma versão (tag ou branch) e reinicia. O banco é preservado; as migrações rodam na subida da API.
# Uso: ./update.sh v0.11.0
set -euo pipefail
REF="${1:?informe a versão, ex.: ./update.sh v0.11.0}"
cd "$(dirname "$0")"
./backup.sh            # backup antes de atualizar
git -C ../.. fetch --tags origin
git -C ../.. checkout "$REF"
docker compose build
docker compose up -d
docker compose ps
echo "atualizado para $REF"
