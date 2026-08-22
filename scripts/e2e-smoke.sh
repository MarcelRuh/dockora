#!/usr/bin/env bash
# Dockora E2E smoke against a running API (default http://127.0.0.1:3001)
set -euo pipefail

API="${DOCKORA_API_URL:-http://127.0.0.1:3001}"
EMAIL="${SMOKE_EMAIL:-admin@dockora.local}"
PASSWORD="${SMOKE_PASSWORD:-dockora-admin-change-me}"

echo "==> Health"
curl -fsS "$API/api/v1/health" | grep -q '"status"' || { echo "health failed"; exit 1; }

echo "==> Auth status"
STATUS=$(curl -fsS "$API/api/v1/auth/status")
echo "$STATUS"

AUTH_ENABLED=$(echo "$STATUS" | sed -n 's/.*"authEnabled"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' | head -1)

TOKEN=""
if [[ "$AUTH_ENABLED" == "true" ]]; then
  echo "==> Login"
  LOGIN=$(curl -fsS -X POST "$API/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
  TOKEN=$(echo "$LOGIN" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  if [[ -z "$TOKEN" ]]; then
    echo "login failed: $LOGIN"
    exit 1
  fi
  AUTH_HEADER=(-H "authorization: Bearer $TOKEN")

  echo "==> Login lockout (invalid password once – must not lock yet)"
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$API/api/v1/auth/login" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$EMAIL\",\"password\":\"definitely-wrong-password\"}" || true)
  if [[ "$CODE" != "401" && "$CODE" != "429" ]]; then
    echo "FAIL: expected 401 for bad login, got $CODE"
    exit 1
  fi
else
  AUTH_HEADER=()
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

echo "==> Settings (webhook must be masked if set)"
SETTINGS=$(curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/settings")
if echo "$SETTINGS" | grep -Eq 'discord\.com/api/webhooks'; then
  echo "FAIL: webhook secret leaked in settings response"
  exit 1
fi

echo "==> Audit"
curl -fsS "${AUTH_HEADER[@]}" "$API/api/v1/audit?limit=5" >/dev/null

echo "OK smoke passed against $API"
