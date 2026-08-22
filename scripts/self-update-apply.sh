#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: DOCKORA_INSTALL_DIR, DOCKORA_REPO, DOCKORA_UPDATE_BRANCH
#      DOCKORA_SKIP_COMPOSE=1  → nur Dateien syncen, kein compose rebuild
set -eu

INSTALL_DIR="${DOCKORA_INSTALL_DIR:-/install}"
REPO="${DOCKORA_REPO:-MarcelRuh/dockora}"
BRANCH="${DOCKORA_UPDATE_BRANCH:-main}"
SKIP_COMPOSE="${DOCKORA_SKIP_COMPOSE:-0}"
API_URL="https://api.github.com/repos/${REPO}/commits/${BRANCH}"
TARBALL_URL="https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz"
CLONE_URL="https://github.com/${REPO}.git"

echo "==> Dockora self-update"
echo "    dir=${INSTALL_DIR} repo=${REPO} branch=${BRANCH} skip_compose=${SKIP_COMPOSE}"

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

if [ "$SKIP_COMPOSE" != "1" ]; then
  need docker
  if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: docker compose plugin required" >&2
    exit 1
  fi
fi

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return 0
  fi
  if command -v apk >/dev/null 2>&1; then
    apk add --no-cache git >/dev/null 2>&1 || return 1
  fi
  command -v git >/dev/null 2>&1
}

parse_sha() {
  printf '%s' "$1" | tr -d '\n' | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\([a-f0-9]\{40\}\)".*/\1/p' | head -1
}

resolve_sha() {
  if command -v git >/dev/null 2>&1; then
    SHA="$(git ls-remote "$CLONE_URL" "refs/heads/${BRANCH}" | awk '{print $1}' | head -1 || true)"
    if [ -n "${SHA:-}" ]; then
      echo "$SHA"
      return 0
    fi
  fi
  AUTH_HEADER=""
  if [ -n "${GITHUB_TOKEN:-}${GH_TOKEN:-}" ]; then
    AUTH_HEADER="Authorization: Bearer ${GITHUB_TOKEN:-${GH_TOKEN:-}}"
  fi
  if [ -n "$AUTH_HEADER" ]; then
    RAW="$(wget -qO- --header="Accept: application/vnd.github+json" --header="User-Agent: dockora-self-update" --header="$AUTH_HEADER" "$API_URL")"
  else
    RAW="$(wget -qO- --header="Accept: application/vnd.github+json" --header="User-Agent: dockora-self-update" "$API_URL")"
  fi
  SHA="$(parse_sha "$RAW")"
  if [ -z "$SHA" ]; then
    echo "ERROR: could not parse remote commit SHA" >&2
    exit 1
  fi
  echo "$SHA"
}

sync_via_git() {
  git config --global --add safe.directory "$INSTALL_DIR" >/dev/null 2>&1 || true
  if ! git -C "$INSTALL_DIR" remote get-url origin >/dev/null 2>&1; then
    git -C "$INSTALL_DIR" remote add origin "$CLONE_URL" >/dev/null 2>&1 || true
  fi
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  LOCAL="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  REMOTE="$(git -C "$INSTALL_DIR" rev-parse FETCH_HEAD)"
  if [ "$LOCAL" = "$REMOTE" ]; then
    echo "    git already at $REMOTE"
    return 0
  fi
  if git -C "$INSTALL_DIR" merge --ff-only FETCH_HEAD; then
    return 0
  fi
  echo "    git not fast-forward – using tarball overlay"
  return 1
}

sync_via_tarball() {
  echo "==> Downloading source tarball"
  wget -qO "$TMP/src.tgz" "$TARBALL_URL"
  tar -xzf "$TMP/src.tgz" -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d ! -name '.' | head -1)"
  if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
    echo "ERROR: failed to extract source archive" >&2
    exit 1
  fi
  echo "==> Syncing files (preserving .env, data/, .git)"
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
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Resolving remote revision"
ensure_git || true
SHA="$(resolve_sha)"
echo "    remote=$SHA"

if [ -d "${INSTALL_DIR}/.git" ] && ensure_git && sync_via_git; then
  echo "==> Git sync complete"
  SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
else
  sync_via_tarball
fi

if [ "$SKIP_COMPOSE" = "1" ]; then
  printf '%s\n' "$SHA" > "${INSTALL_DIR}/.dockora-revision"
  echo "    wrote .dockora-revision"
  echo "==> Skip compose rebuild (host/dev mode)"
  echo "==> Done. Restart API/Web if they do not hot-reload."
  exit 0
fi

echo "==> Rebuilding stack (docker compose up -d --build)"
cd "$INSTALL_DIR"
PROFILES=""
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'dockora-proxy'; then
  PROFILES="--profile proxy"
fi
# shellcheck disable=SC2086
docker compose $PROFILES up -d --build --remove-orphans

# Nginx resolves upstream IPs at start; force-recreate so a stale web/api IP cannot 502
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'dockora-proxy'; then
  echo "==> Refreshing proxy (pick up new api/web IPs + nginx.conf)"
  # shellcheck disable=SC2086
  docker compose $PROFILES up -d --force-recreate --no-deps proxy
fi

# Only mark deployed after a successful rebuild
printf '%s\n' "$SHA" > "${INSTALL_DIR}/.dockora-revision"
echo "    wrote .dockora-revision"

echo "==> Pruning Docker build cache"
docker builder prune -af || true
echo "==> Pruning dangling images"
docker image prune -f || true

echo "==> Done. Dockora should come back shortly."
