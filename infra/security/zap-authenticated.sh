#!/usr/bin/env bash
#
# zap-authenticated.sh — OWASP ZAP baseline scan run AS A LOGGED-IN USER of a given role
# (docs/09 §7, docs/runbook-security.md; план СЭД этап 11 «ZAP authenticated profiles для
# clerk/chief/employee»).
#
# Why this exists next to zap-baseline.sh: the anonymous scan sees the login page and almost
# nothing else. Every screen this platform is actually about — the register, a document card,
# the archive, the exchange inbox — is behind a session, and so is every header and every
# response body that could leak. A green anonymous baseline says nothing about them.
#
# Usage (from repo root):
#   ZAP_CLERK_USER=... ZAP_CLERK_PASS=... ./infra/security/zap-authenticated.sh https://staging.<domain> clerk
#   ./infra/security/zap-authenticated.sh https://staging.<domain> chief
#   ./infra/security/zap-authenticated.sh https://staging.<domain> employee
#
# The role only picks which credentials are used; run it once per role, because what a scan can
# reach is exactly what that role's permissions allow, and that difference is the point.
#
# SAFETY:
#   * Staging only. The spider issues real requests as a real user.
#   * The report contains the requests it sent, INCLUDING the session cookie. Treat
#     zap-report-<role>.html as a credential, and log the account out afterwards (the script
#     does it for you unless ZAP_KEEP_SESSION=1).
set -euo pipefail

TARGET="${1:-${ZAP_TARGET:-}}"
ROLE="${2:-${ZAP_ROLE:-clerk}}"
if [ -z "${TARGET}" ]; then
  echo "usage: $0 https://staging.<domain> <clerk|chief|employee>" >&2
  exit 2
fi

case "${ROLE}" in
  clerk)    USER_VAR=ZAP_CLERK_USER;    PASS_VAR=ZAP_CLERK_PASS ;;
  chief)    USER_VAR=ZAP_CHIEF_USER;    PASS_VAR=ZAP_CHIEF_PASS ;;
  employee) USER_VAR=ZAP_EMPLOYEE_USER; PASS_VAR=ZAP_EMPLOYEE_PASS ;;
  *) echo "unknown role '${ROLE}' — expected clerk, chief or employee" >&2; exit 2 ;;
esac
USERNAME="${!USER_VAR:-}"
PASSWORD="${!PASS_VAR:-}"
if [ -z "${USERNAME}" ] || [ -z "${PASSWORD}" ]; then
  echo "set ${USER_VAR} and ${PASS_VAR} for the ${ROLE} profile" >&2
  exit 2
fi

DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="${ZAP_OUT:-zap-report-${ROLE}.html}"

# Same refusal as the anonymous scan: with -I, a run with no FAIL rule cannot fail whatever it
# finds, and a gate that is green because it is empty is worse than no gate.
if ! grep -qE '^[0-9]+[[:space:]]+FAIL' "${DIR}/zap-rules.tsv"; then
  echo "zap-rules.tsv has no FAIL rule — this scan could not fail. Refusing to report a gate." >&2
  exit 1
fi

# 1. Log in and capture the session. Done here rather than through ZAP's own authentication
#    because the app uses a plain session cookie + double-submit CSRF: a login POST and two
#    cookies is the whole handshake, and expressing that as a ZAP context script would be more
#    moving parts for the same result.
COOKIE_JAR="$(mktemp)"
trap 'rm -f "${COOKIE_JAR}"' EXIT
LOGIN_BODY="$(printf '{"username":"%s","password":"%s"}' "${USERNAME}" "${PASSWORD}")"
LOGIN_CODE="$(curl -sS -o /dev/null -w '%{http_code}' -c "${COOKIE_JAR}" \
  -H 'Content-Type: application/json' -d "${LOGIN_BODY}" \
  "${TARGET}/api/auth/login")"
if [ "${LOGIN_CODE}" != "200" ]; then
  echo "login as ${USERNAME} failed (HTTP ${LOGIN_CODE}) — check the credentials, and that the" >&2
  echo "account is past the 2FA-enrollment gate (a gated account cannot be scanned)." >&2
  exit 1
fi

cookie_value() { awk -v n="$1" '$6 == n { print $7 }' "${COOKIE_JAR}" | tail -n1; }
SESSION="$(cookie_value cuks_session)"
CSRF="$(cookie_value cuks_csrf)"
if [ -z "${SESSION}" ]; then
  echo "login returned 200 but no cuks_session cookie — is TARGET the API origin?" >&2
  exit 1
fi

logout() {
  if [ "${ZAP_KEEP_SESSION:-0}" != "1" ]; then
    curl -sS -o /dev/null -b "${COOKIE_JAR}" -H "x-csrf-token: ${CSRF}" \
      -X POST "${TARGET}/api/auth/logout" || true
  fi
}
trap 'logout; rm -f "${COOKIE_JAR}"' EXIT

# 2. Replacer rules inject the session into every request ZAP makes. `matchtype=REQ_HEADER`
#    with an existing header name replaces it; with a new one, adds it.
#
#    Every value below must be SPACE-FREE: zap-baseline.py takes `-z` as one string and splits
#    it on whitespace, so a description with a space in it silently becomes two broken options
#    and the rule never applies — which looks exactly like a scan that found nothing.
ZAP_OPTS=(
  "replacer.full_list(0).description=cuks-session"
  "replacer.full_list(0).enabled=true"
  "replacer.full_list(0).matchtype=REQ_HEADER"
  "replacer.full_list(0).matchstr=Cookie"
  "replacer.full_list(0).regex=false"
  "replacer.full_list(0).replacement=cuks_session=${SESSION};cuks_csrf=${CSRF}"
  "replacer.full_list(1).description=cuks-csrf"
  "replacer.full_list(1).enabled=true"
  "replacer.full_list(1).matchtype=REQ_HEADER"
  "replacer.full_list(1).matchstr=x-csrf-token"
  "replacer.full_list(1).regex=false"
  "replacer.full_list(1).replacement=${CSRF}"
  # The spider WILL find the logout endpoint, and one request to it ends the scan's session
  # while leaving the run apparently fine — every subsequent page just redirects to the login
  # screen and reports nothing. Excluded, along with the other session-destroying routes.
  "globalexcludeurl.url_list.url(0).regex=.*/api/auth/logout.*"
  "globalexcludeurl.url_list.url(0).description=logout-ends-the-scan-session"
  "globalexcludeurl.url_list.url(0).enabled=true"
  "globalexcludeurl.url_list.url(1).regex=.*/api/auth/(password|totp).*"
  "globalexcludeurl.url_list.url(1).description=password-change-invalidates-the-session"
  "globalexcludeurl.url_list.url(1).enabled=true"
)

# 3. `-j` runs the AJAX spider as well: this is a React SPA, and the classic spider following
#    <a href> would find a single page and call it a site.
docker run --rm -v "${DIR}":/zap/wrk:rw ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t "${TARGET}" -c "zap-rules.tsv" -r "${OUT}" -w "zap-report-${ROLE}.md" \
  -j -a -I -z "${ZAP_OPTS[*]}"

echo "ZAP ${ROLE} report written to ${DIR}/${OUT}"
echo "It contains the session cookie used for the scan — handle it as a credential."
