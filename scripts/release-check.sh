#!/usr/bin/env bash
# Pre-publish sanity check (no Docker required)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> typecheck"
pnpm typecheck

echo "==> test"
pnpm test

echo "==> build"
DATABASE_URL="${DATABASE_URL:-file:./ci.db}" \
JWT_SECRET="${JWT_SECRET:-ci-test-secret-at-least-16-chars}" \
NEXT_TELEMETRY_DISABLED=1 \
pnpm build

echo "OK release-check passed"
