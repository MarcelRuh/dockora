#!/usr/bin/env bash
# Dockora E2E smoke against a running API (default http://127.0.0.1:3001)
set -euo pipefail

API="${DOCKORA_API_URL:-http://127.0.0.1:3001}"
EMAIL="${SMOKE_EMAIL:-admin@dockora.local}"
PASSWORD="${SMOKE_PASSWORD:-dockora-admin-change-me}"

LOGIN_HDR=""
COOKIE_JAR=""
cleanup() {
  rm -f "$LOGIN_HDR" "$COOKIE_JAR"
}
trap cleanup EXIT

echo "==> Health"
curl -fsS "$API/api/v1/health" | grep -q '"status"' || { echo "health failed"; exit 1; }

echo "==> Auth status"
STATUS=$(curl -fsS "$API/api/v1/auth/status")
echo "$STATUS"

AUTH_ENABLED=$(echo "$STATUS" | sed -n 's/.*"authEnabled"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' | head -1)

TOKEN=""
AUTH_HEADER=()
if [[ "$AUTH_ENABLED" == "true" ]]; then
  echo "==> Login"
  LOGIN_HDR=$(mktemp)
  COOKIE_JAR=$(mktemp)
  LOGIN=$(curl -fsS -D "$LOGIN_HDR" -c "$COOKIE_JAR" -X POST "$API/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  if [[ -z "$TOKEN" ]]; then
    echo "login failed (no token – TOTP required?): $(echo "$LOGIN" | cut -c1-120)"
    exit 1
  fi
  SESSION_COOKIE_LINE=$(grep -i '^set-cookie:[[:space:]]*dockora_session=' "$LOGIN_HDR" | head -1 || true)
  if [[ -z "$SESSION_COOKIE_LINE" ]]; then
    echo "FAIL: login did not Set-Cookie dockora_session"
    exit 1
  fi
  SESSION_COOKIE_ATTRS=${SESSION_COOKIE_LINE#*;}
  if [[ "$API" == http://* ]] && echo "$SESSION_COOKIE_ATTRS" | grep -qiE '(^|[[:space:];])secure([[:space:];]|$)'; then
    echo "FAIL: session cookie is Secure on HTTP (browser would drop it)"
    exit 1
  fi
  AUTH_HEADER=(-H "authorization: Bearer $TOKEN")

  echo "==> Cookie session (/auth/me without Bearer)"
  curl -fsS -b "$COOKIE_JAR" "$API/api/v1/auth/me" | grep -q '"email"' || {
    echo "FAIL: session cookie was not accepted by /auth/me"; exit 1;
  }

  echo "==> OpenAPI requires auth"
  DOCS_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$API/api/docs")
  if [[ "$DOCS_CODE" != "401" ]]; then
    echo "FAIL: /api/docs should be 401 without auth, got $DOCS_CODE"
    exit 1
  fi
  curl -fsS "${AUTH_HEADER[@]}" "$API/api/docs" >/dev/null || {
    echo "FAIL: /api/docs with Bearer should succeed"; exit 1;
  }

  echo "==> Login lockout (invalid password once – must not lock yet)"
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"definitely-wrong-password\"}" || true)
  if [[ "$CODE" != "401" && "$CODE" != "429" ]]; then
    echo "FAIL: expected 401 for bad login, got $CODE"
    exit 1
  fi
fi

echo "==> Containers list"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/containers" >/dev/null

echo "==> Compose list"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/compose" >/dev/null

echo "==> Updates list"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/updates" >/dev/null

echo "==> Backups list"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/backups" >/dev/null

echo "==> System info"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/system/info" | grep -q '"version"' || {
  echo "system/info missing version"; exit 1;
}

echo "==> Self-update status"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/system/self-update" | grep -q '"enabled"' || {
  echo "self-update status failed"; exit 1;
}

echo "==> Plugins"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/plugins" | grep -q '"plugins"' || {
  echo "plugins endpoint failed"; exit 1;
}

echo "==> Dashboard"
DASHBOARD=$(curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/dashboard")
echo "$DASHBOARD" | grep -q '"lifetime"' || { echo "dashboard missing lifetime"; exit 1; }

echo "==> Settings (webhook must be masked if set)"
SETTINGS=$(curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/settings")
if echo "$SETTINGS" | grep -Eq 'discord\.com/api/webhooks'; then
  echo "FAIL: webhook secret leaked in settings response"
  exit 1
fi

echo "==> Audit"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/audit?limit=5" >/dev/null

echo "OK smoke passed against $API"
