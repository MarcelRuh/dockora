#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: DOCKORA_INSTALL_DIR, DOCKORA_REPO, DOCKORA_UPDATE_BRANCH
set -eu

INSTALL_DIR="${DOCKORA_INSTALL_DIR:-/install}"
REPO="${DOCKORA_REPO:-MarcelRuh/dockora}"
BRANCH="${DOCKORA_UPDATE_BRANCH:-main}"
API_URL="https://api.github.com/repos/${REPO}/commits/${BRANCH}"
TARBALL_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"

echo "==> Dockora self-update"
echo "    dir=${INSTALL_DIR} repo=${REPO} branch=${BRANCH}"

if [ ! -f "${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "ERROR: docker-compose.yml missing in ${INSTALL_DIR}" >&2
  exit 1
fi

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: missing command: $1" >&2
    exit 1
  }
}

need wget
need tar
need docker

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: docker compose plugin required" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Resolving remote revision"
RAW="$(wget -qO- --header="Accept: application/vnd.github+json" --header="User-Agent: dockora-self-update" "$API_URL")"
SHA="$(printf '%s' "$RAW" | sed -n 's/.*"sha": *"\([a-f0-9]\{40\}\)".*/\1/p' | head -1)"
if [ -z "$SHA" ]; then
  echo "ERROR: could not parse remote commit SHA" >&2
  exit 1
fi
echo "    remote=$SHA"

echo "==> Downloading source tarball"
wget -qO "$TMP/src.tgz" "$TARBALL_URL"
tar -xzf "$TMP/src.tgz" -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d ! -name '.' | head -1)"
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "ERROR: failed to extract source archive" >&2
  exit 1
fi

echo "==> Syncing files (preserving .env, data/, local overrides)"
cd "$SRC"
tar cf - \
  --exclude='./.env' \
  --exclude='./data' \
  --exclude='./.dockora-revision' \
  --exclude='./.git' \
  --exclude='./node_modules' \
  --exclude='./apps/api/node_modules' \
  --exclude='./apps/web/node_modules' \
  --exclude='./apps/web/.next' \
  . | (cd "$INSTALL_DIR" && tar xf -)

printf '%s\n' "$SHA" > "${INSTALL_DIR}/.dockora-revision"
echo "    wrote .dockora-revision"

echo "==> Rebuilding stack (docker compose up -d --build)"
cd "$INSTALL_DIR"
PROFILES=""
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'dockora-proxy'; then
  PROFILES="--profile proxy"
fi
# shellcheck disable=SC2086
docker compose $PROFILES up -d --build

echo "==> Done. Dockora should come back shortly."
