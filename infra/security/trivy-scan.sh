#!/usr/bin/env bash
#
# trivy-scan.sh — scan the CUKS container images for OS/library vulnerabilities (docs/09 §7,
# docs/runbook-security.md, task 7.5). Fails on CRITICAL (and HIGH unless TRIVY_SEVERITY overrides).
# Accepted/unfixable CVEs go in infra/security/.trivyignore with a comment + date.
#
# Usage (from repo root, after `dc build`):
#   ./infra/security/trivy-scan.sh
#   TRIVY_SEVERITY=CRITICAL,HIGH,MEDIUM ./infra/security/trivy-scan.sh
#
set -euo pipefail

SEVERITY="${TRIVY_SEVERITY:-CRITICAL,HIGH}"
IGNOREFILE="$(cd "$(dirname "$0")" && pwd)/.trivyignore"

# The images we build + the pinned third-party images that face the app. Update if compose changes.
IMAGES=(
  "cuks-api"
  "cuks-worker"
  "cuks-caddy"
  "cuks-backup"
  "postgis/postgis:17-3.5"
  "redis:7-alpine"
  "minio/minio:latest"
  "caddy:2.8-alpine"
  "livekit/livekit-server:latest"
  "louislam/uptime-kuma:1"
)

if ! command -v trivy >/dev/null 2>&1; then
  echo "trivy not found — install: https://aquasecurity.github.io/trivy/ (or run via docker:" >&2
  echo "  docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy image <img>)" >&2
  exit 127
fi

rc=0
for img in "${IMAGES[@]}"; do
  echo "=== trivy: ${img} (severity ${SEVERITY}) ==="
  trivy image --scanners vuln --severity "${SEVERITY}" --ignorefile "${IGNOREFILE}" \
    --exit-code 1 --no-progress "${img}" || rc=1
done

if [ "${rc}" -ne 0 ]; then
  echo "trivy found unignored ${SEVERITY} vulnerabilities — fix or justify in .trivyignore" >&2
fi
exit "${rc}"
