#!/usr/bin/env bash
#
# restore-verify.sh — check that a restore actually brought back what the acceptance criterion
# asks for: «restore восстанавливает БД и связанные file versions» (план СЭД, этап 11;
# docs/runbook-backup.md §Учение по восстановлению).
#
# The distinction this exists for: `restore.sh` finishing without an error means the dump was
# applied and the volumes were copied. It does NOT mean the database and the object store agree.
# A dump taken while an upload was in flight, a volume mounted read-only, a snapshot missing the
# minio path — all of those produce a restore that "succeeded" and a register whose documents
# open to a download that 404s. Nobody notices until somebody needs the letter.
#
# Run INSIDE the backup container after restore.sh, with the minio volume mounted (:ro is enough):
#   docker compose --env-file .env -f infra/docker/compose.prod.yaml \
#     run --rm -v cuks_miniodata:/data/minio:ro backup restore-verify.sh
#
# Exit codes: 0 all checks passed, 1 a check failed (details on stdout).
set -uo pipefail

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}" "${POSTGRES_PASSWORD:?}"
PG_HOST="${PG_HOST:-postgres}"
BUCKET="${S3_BUCKET:-cuks}"
MINIO_DIR="${MINIO_DIR:-/data/minio}"
# How many file versions to check against the object store. Every row would be a full directory
# walk over the whole bucket on a real installation; a sample answers the question the drill
# actually asks ("did the bytes come back at all"). Set 0 to check every row.
SAMPLE="${VERIFY_SAMPLE:-200}"

log() { echo "[verify $(date -u +%FT%TZ)] $*"; }
FAILED=0
fail() { echo "  FAIL: $*"; FAILED=$((FAILED + 1)); }

psql_q() {
  PGPASSWORD="${POSTGRES_PASSWORD}" psql -h "${PG_HOST}" -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    -v ON_ERROR_STOP=1 -qtAc "$1"
}

# --- 1. The docflow tables are present and populated -------------------------------------------
#
# Listed explicitly rather than counted generically: a pg_restore that silently skipped a table
# leaves the others intact, and «база восстановилась» is exactly the sentence that hides it.
log "checking docflow tables"
DOCFLOW_TABLES="journals journal_counters correspondents nomenclature documents document_files
document_collaborators routes route_steps route_templates resolutions resolution_proposals
acquaintance_batches acquaintances signatures certificates document_dispatches
document_exchange_inbound document_exchange_attachments document_templates"

for t in ${DOCFLOW_TABLES}; do
  if ! psql_q "SELECT to_regclass('app.${t}') IS NOT NULL;" | grep -q '^t$'; then
    fail "table app.${t} does not exist after restore"
  fi
done

DOC_COUNT="$(psql_q "SELECT count(*) FROM app.documents;" || echo "")"
if [ -z "${DOC_COUNT}" ]; then
  fail "could not read app.documents at all"
else
  log "app.documents rows: ${DOC_COUNT}"
  # An empty register after restoring a production snapshot is a restore that did nothing.
  # A genuinely empty source is possible only on a fresh install, so this warns rather than
  # fails only when the operator says so.
  if [ "${DOC_COUNT}" = "0" ] && [ "${ALLOW_EMPTY:-0}" != "1" ]; then
    fail "app.documents is empty — set ALLOW_EMPTY=1 if the source really had no documents"
  fi
fi

# --- 2. Referential sanity: no document points at a file version that is gone -------------------
log "checking document → file version references"
ORPHANS="$(psql_q "
  SELECT count(*) FROM app.document_files df
  LEFT JOIN app.fs_nodes n ON n.id = df.node_id
  WHERE n.id IS NULL;" || echo "")"
if [ -z "${ORPHANS}" ]; then
  fail "could not check document_files references"
elif [ "${ORPHANS}" != "0" ]; then
  fail "${ORPHANS} document_files rows point at a missing fs_node"
else
  log "document_files references: all resolve"
fi

# --- 3. The bytes: every sampled file version has an object in the restored bucket --------------
#
# MinIO stores each object under <bucket>/<key>/ (xl.meta plus part files, or inlined). Checking
# for the DIRECTORY is layout-independent — asserting a particular file name inside it would
# break on the next MinIO release and report a data loss that never happened.
if [ ! -d "${MINIO_DIR}/${BUCKET}" ]; then
  fail "${MINIO_DIR}/${BUCKET} is not present — the minio volume was not restored or not mounted"
else
  LIMIT_SQL=""
  if [ "${SAMPLE}" != "0" ]; then
    LIMIT_SQL="LIMIT ${SAMPLE}"
    log "checking object bytes for up to ${SAMPLE} file versions in ${MINIO_DIR}/${BUCKET}"
  else
    log "checking object bytes for EVERY file version in ${MINIO_DIR}/${BUCKET}"
  fi
  MISSING=0
  CHECKED=0
  # Newest first: the tail of the snapshot is where an in-flight upload would have been lost.
  while IFS= read -r key; do
    [ -z "${key}" ] && continue
    CHECKED=$((CHECKED + 1))
    if [ ! -e "${MINIO_DIR}/${BUCKET}/${key}" ]; then
      MISSING=$((MISSING + 1))
      [ "${MISSING}" -le 10 ] && echo "  missing object: ${key}"
    fi
  done <<EOF
$(psql_q "
  SELECT fv.storage_key
  FROM app.file_versions fv
  JOIN app.document_files df ON df.node_id = fv.node_id
  ORDER BY fv.created_at DESC ${LIMIT_SQL};" || true)
EOF
  log "object bytes checked: ${CHECKED}, missing: ${MISSING}"
  if [ "${CHECKED}" = "0" ] && [ "${DOC_COUNT:-0}" != "0" ] && [ "${ALLOW_EMPTY:-0}" != "1" ]; then
    fail "no document file versions to check, but the register has documents"
  fi
  [ "${MISSING}" != "0" ] && fail "${MISSING} of ${CHECKED} document file versions have no object"
fi

# --- 4. Registration counters survived ---------------------------------------------------------
#
# The counters are the one piece of docflow state that cannot be recomputed from the documents:
# restoring the register without them lets the next registration re-issue a number that already
# exists on paper, and the duplicate is only discovered by the organisation that received both.
#
# Compared by COUNT, not by parsing the number: `{seq4}/{MM}-{YYYY}` and friends make the seq
# unrecoverable from the rendered string. Each successful registration increments exactly one
# counter row by one (a rolled-back one rolls the increment back too), so the number of
# registered documents in a journal is a sound lower bound for the sum of its counters. Deleted
# documents are counted — a soft-deleted document still consumed its number.
log "checking registration counters"
COUNTER_MISMATCH="$(psql_q "
  WITH used AS (
    SELECT journal_id, count(*) AS issued
    FROM app.documents
    WHERE journal_id IS NOT NULL AND reg_number IS NOT NULL
    GROUP BY journal_id
  ), held AS (
    SELECT journal_id, sum(last_seq) AS counted
    FROM app.journal_counters
    GROUP BY journal_id
  )
  SELECT count(*) FROM used
  LEFT JOIN held ON held.journal_id = used.journal_id
  WHERE coalesce(held.counted, 0) < used.issued;" || echo "")"
if [ -z "${COUNTER_MISMATCH}" ]; then
  fail "could not check registration counters"
elif [ "${COUNTER_MISMATCH}" != "0" ]; then
  fail "${COUNTER_MISMATCH} journal(s) hold a counter BELOW the numbers already issued — the next"
  fail "registration would duplicate an existing number. Fix before letting users in."
else
  log "registration counters: at or ahead of every issued number"
fi

# --- Verdict -----------------------------------------------------------------------------------
if [ "${FAILED}" -gt 0 ]; then
  log "RESTORE VERIFICATION FAILED: ${FAILED} check(s) did not pass"
  exit 1
fi
log "restore verification passed"
