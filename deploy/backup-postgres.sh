#!/bin/sh
# Daily PostgreSQL backup for the docker compose setup. Keeps the newest 14 files.
# Cron example (03:15 every day):
#   15 3 * * * cd /opt/leads && sh deploy/backup-postgres.sh >> /var/log/leads-backup.log 2>&1
# Restore: gunzip -c backups/leads-<date>.sql.gz | docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db psql -U leads -d leads
set -eu
cd "$(dirname "$0")/.."
mkdir -p backups
file="backups/leads-$(date +%Y-%m-%d_%H%M).sql.gz"
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec -T db pg_dump -U leads -d leads --no-owner | gzip > "$file"
echo "$(date -Iseconds) backup written: $file"
ls -1t backups/leads-*.sql.gz | tail -n +15 | xargs -r rm --
