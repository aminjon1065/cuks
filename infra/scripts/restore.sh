#!/usr/bin/env bash
#
# restore.sh — restore the CUKS stack from a restic snapshot (docs/08 §Бэкапы,
# task 7.2). Used for the quarterly restore drill on a clean VM and for real
# disaster recovery. DESTRUCTIVE: it overwrites the target database and volumes.
#
# Prerequisites: postgres (empty DB) reachable, and — to restore object/config
# data — this container must mount the target volumes READ-WRITE. The scheduled
# `backup` service mounts them :ro, so run restore via the one-off RW invocation
# documented in docs/runbook-backup.md.
#
# Usage (inside the container):
#   restore.sh [snapshot]        # snapshot id, or "latest" (default)
#
set -euo pipefail

SNAP="${1:-latest}"
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"
: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${POSTGRES_PASSWORD:?}"
PG_HOST="${PG_HOST:-postgres}"
RESTORE_DIR="${RESTORE_DIR:-/restore}"

log() { echo "[restore $(date -u +%FT%TZ)] $*"; }

# 1. Materialise the snapshot. restic preserves absolute paths, so the dump lands
#    at $RESTORE_DIR/staging/pg/*.dump and volumes at $RESTORE_DIR/data/<name>.
log "restoring snapshot '${SNAP}' from ${RESTIC_REPOSITORY} -> ${RESTORE_DIR}"
rm -rf "${RESTORE_DIR}"
mkdir -p "${RESTORE_DIR}"
restic restore "${SNAP}" --target "${RESTORE_DIR}"

# 2. Postgres: restore the dump into the (empty) database over the network.
#    --clean --if-exists makes it idempotent if the DB isn't pristine.
DUMP="$(find "${RESTORE_DIR}" -path '*/pg/*.dump' | head -n1)"
[ -n "${DUMP}" ] || { echo "restore: no pg dump found in snapshot" >&2; exit 1; }
log "pg_restore ${DUMP} -> ${POSTGRES_DB}@${PG_HOST}"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore -h "${PG_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  --clean --if-exists --no-owner --no-privileges "${DUMP}"

# 3. Volumes: copy files back where the target is mounted read-write.
restore_volume() {
  local name="$1" src="${RESTORE_DIR}/data/$1" dst="/data/$1"
  [ -d "${src}" ] || { log "skip ${name} (not in snapshot)"; return 0; }
  if [ ! -d "${dst}" ] || [ ! -w "${dst}" ]; then
    log "skip ${name} — ${dst} is not writable (mount it :rw to restore, see runbook)"
    return 0
  fi
  log "restoring ${name} -> ${dst}"
  cp -a "${src}/." "${dst}/"
}
restore_volume minio
restore_volume geoserver
restore_volume ca
restore_volume caddy

log "restore complete — start the full stack and run the smoke checks (runbook §Проверка)"
