#!/usr/bin/env bash
#
# backup-entrypoint.sh — entrypoint for the `backup` container (task 7.2).
#   - With arguments: exec them directly (one-off backup.sh / restore.sh / restic).
#   - With none: schedule backup.sh via busybox crond at $BACKUP_CRON.
#
# busybox crond runs jobs with a bare environment, so the container env the job
# needs (repo, PG creds, RESTIC_PASSWORD) is persisted to /etc/backup.env and the
# cron line sources it. Values are quoted with printf %q so special characters
# survive.
#
set -euo pipefail

# One-off invocation (docker compose run/exec ... backup.sh|restore.sh|restic ...).
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

: "${BACKUP_CRON:=0 2 * * *}"

: >/etc/backup.env
for v in RESTIC_REPOSITORY RESTIC_PASSWORD RESTIC_PASSWORD_FILE \
  POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB PG_HOST \
  KEEP_DAILY KEEP_MONTHLY BACKUP_STAGE_DIR BACKUP_TAGS TZ; do
  if [ -n "${!v+x}" ]; then
    printf 'export %s=%q\n' "$v" "${!v}" >>/etc/backup.env
  fi
done

mkdir -p /var/spool/cron/crontabs
# Log to PID 1's stdout so `docker logs` / compose logging sees each run.
printf '%s . /etc/backup.env; /usr/local/bin/backup.sh >> /proc/1/fd/1 2>&1\n' \
  "${BACKUP_CRON}" >/var/spool/cron/crontabs/root

echo "[backup] scheduled '${BACKUP_CRON}' (TZ=${TZ:-UTC}); repo=${RESTIC_REPOSITORY:-unset}"
exec crond -f -l 8
