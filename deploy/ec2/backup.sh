#!/usr/bin/env bash
# Backup diário do PostgreSQL: dump comprimido local + cópia no S3. Rode pelo cron (veja README).
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
STAMP=$(date +%Y%m%d-%H%M%S)
DIR=./backups
mkdir -p "$DIR"
FILE="$DIR/dpts-$STAMP.sql.gz"
docker compose exec -T db pg_dump -U app -d traceability | gzip > "$FILE"
# Dump vazio ou corrompido não conta como backup.
test "$(gzip -dc "$FILE" | wc -c)" -gt 1000
if [ -n "${BACKUP_BUCKET:-}" ]; then
  aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/dpts/$(basename "$FILE")" --only-show-errors
fi
find "$DIR" -name 'dpts-*.sql.gz' -mtime +"${BACKUP_KEEP_DAYS:-7}" -delete
echo "backup ok: $FILE"
