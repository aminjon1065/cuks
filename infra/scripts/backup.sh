#!/usr/bin/env bash
#
# backup.sh — full nightly backup of the CUKS production stack into an encrypted
# restic repository (docs/08 §Бэкапы, docs/09 §6, task 7.2). Runs inside the
# `backup` container (infra/docker/Dockerfile `backup` target), which reaches
# Postgres over the compose network and mounts the data volumes read-only.
#
# What it captures (RPO 24h):
#   - PostgreSQL: pg_dump -Fc (logical, point-in-time consistent) of the database.
#   - MinIO objects: the miniodata volume (files, documents, recordings).
#   - GeoServer config, the internal CA key (ca_data), Caddy certs.
# Redis (sessions / BullMQ queues, transient) is intentionally NOT backed up.
#
# Retention: restic forget --keep-daily $KEEP_DAILY --keep-monthly $KEEP_MONTHLY --prune.
# The repo is encrypted with RESTIC_PASSWORD — keep a copy OFFLINE (docs/runbook-backup.md).
#
# Manual run:
#   docker compose --env-file .env -f infra/docker/compose.prod.yaml exec backup backup.sh
#
set -euo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required (keep a copy offline)}"
: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${POSTGRES_PASSWORD:?}"
PG_HOST="${PG_HOST:-postgres}"
KEEP_DAILY="${KEEP_DAILY:-30}"
KEEP_MONTHLY="${KEEP_MONTHLY:-12}"
STAGE="${BACKUP_STAGE_DIR:-/staging}"

log() { echo "[backup $(date -u +%FT%TZ)] $*"; }

# 1. First run initialises the encrypted repository (idempotent afterwards).
if ! restic cat config >/dev/null 2>&1; then
  log "initialising restic repository at ${RESTIC_REPOSITORY}"
  restic init
fi

# 2. Logical Postgres dump into the staging dir. -Fc (custom) is what pg_restore
#    consumes; --no-owner/--no-privileges keep it portable to a fresh cluster.
mkdir -p "${STAGE}/pg"
log "pg_dump ${POSTGRES_DB}@${PG_HOST}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump -h "${PG_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -Fc --no-owner --no-privileges -f "${STAGE}/pg/${POSTGRES_DB}.dump"

# 3. One snapshot: the dump plus the read-only data volumes. Missing/empty mounts
#    (e.g. no Caddy certs yet) are fine — restic stores an empty tree.
log "restic backup"
restic backup --tag "${BACKUP_TAGS:-scheduled}" --host cuks \
  "${STAGE}/pg" \
  /data/minio /data/geoserver /data/ca /data/caddy

# 4. Retention + prune old snapshots.
log "restic forget --keep-daily ${KEEP_DAILY} --keep-monthly ${KEEP_MONTHLY} --prune"
restic forget --keep-daily "${KEEP_DAILY}" --keep-monthly "${KEEP_MONTHLY}" --prune

# 5. Drop the staged dump — it now lives (encrypted) in the repo.
rm -rf "${STAGE}/pg"

# 6. Cheap integrity check: verify structure + read a 5% sample of pack data.
log "restic check"
restic check --read-data-subset=1/20

log "backup complete"
restic snapshots --compact 2>/dev/null | tail -n 5 || true
