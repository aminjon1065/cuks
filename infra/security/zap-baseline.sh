#!/usr/bin/env bash
#
# zap-baseline.sh — OWASP ZAP baseline scan against a running CUKS stage (docs/09 §7,
# docs/runbook-security.md, task 7.5). "Baseline" = spider + PASSIVE rules only (no active attacks), so
# it is safe to point at staging. Runs ZAP via docker — no local install needed.
#
# Usage (from repo root):
#   ./infra/security/zap-baseline.sh https://staging.<domain>
#   ZAP_TARGET=https://staging.<domain> ./infra/security/zap-baseline.sh
#
# Exits non-zero if any alert is at FAIL level (per zap-rules.tsv) — that is the checklist gate
# ("ZAP без high"). WARN-level alerts are listed for review but don't fail. Report: zap-report.html.
set -euo pipefail

TARGET="${1:-${ZAP_TARGET:-}}"
if [ -z "${TARGET}" ]; then
  echo "usage: $0 https://staging.<domain>   (or set ZAP_TARGET)" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${ZAP_OUT:-zap-report.html}"

# The rules file + report share the ZAP working dir mount. rw so ZAP can write the report back.
docker run --rm -v "${DIR}":/zap/wrk:rw ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t "${TARGET}" -c "zap-rules.tsv" -r "${OUT}" -w zap-report.md -a

echo "ZAP report written to ${DIR}/${OUT}"
