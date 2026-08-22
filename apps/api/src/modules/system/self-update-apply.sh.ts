/**
 * Shell-Skript fuer den One-Shot-Updater-Container (docker:cli).
 * JS-Template: `\${...}` -> Shell sieht `${...}`.
 */
export const SELF_UPDATE_APPLY_SCRIPT = `#!/bin/sh
# Shared apply script (host CLI + in-app updater container).
# Env: DOCKORA_INSTALL_DIR, DOCKORA_REPO, DOCKORA_UPDATE_BRANCH
#      DOCKORA_SKIP_COMPOSE=1  → nur Dateien syncen, kein compose rebuild
set -eu

INSTALL_DIR="\${DOCKORA_INSTALL_DIR:-/install}"
REPO="\${DOCKORA_REPO:-MarcelRuh/dockora}"
BRANCH="\${DOCKORA_UPDATE_BRANCH:-main}"
SKIP_COMPOSE="\${DOCKORA_SKIP_COMPOSE:-0}"
API_URL="https://api.github.com/repos/\${REPO}/commits/\${BRANCH}"
TARBALL_URL="https://github.com/\${REPO}/archive/refs/heads/\${BRANCH}.tar.gz"
CLONE_URL="https://github.com/\${REPO}.git"

PROGRESS_FILE="\${INSTALL_DIR}/.dockora-update-progress"

write_progress() {
  percent="$1"
  step="$2"
  detail="\${3:-}"
  last=0
  if [ -f "$PROGRESS_FILE" ]; then
    parsed="$(sed -n 's/^percent=\\([0-9][0-9]*\\).*/\\1/p' "$PROGRESS_FILE" | head -1)"
    if [ -n "\${parsed:-}" ]; then
      last="$parsed"
    fi
  fi
  if [ "$step" = "error" ]; then
    if [ "$last" -gt 0 ]; then
      percent="$last"
    fi
  elif [ "$percent" -lt "$last" ]; then
    percent="$last"
  fi
  echo "==> [\${percent}%] \${step}\${detail:+ – $detail}"
  printf 'percent=%s\\nstep=%s\\ndetail=%s\\n' "$percent" "$step" "$detail" > "$PROGRESS_FILE"
}

watch_compose_log() {
  pid="$1"
  logf="$2"
  while kill -0 "$pid" 2>/dev/null; do
    log="$(tail -c 16000 "$logf" 2>/dev/null || true)"
    # Highest matching phase first – older lines stay in the tail buffer.
    case "$log" in
      *"Container dockora-web"*"Started"*) write_progress 90 startWeb "Web startet" ;;
      *"Container dockora-api"*"Healthy"*) write_progress 88 startApi "API ist bereit" ;;
      *"Container dockora-api"*"Started"*) write_progress 84 startApi "API startet" ;;
      *"Image dockora-web Built"*) write_progress 80 buildWeb "Web-Image fertig" ;;
      *"Image dockora-api Built"*) write_progress 76 buildApi "API-Image fertig" ;;
      *"exporting to image"*) write_progress 72 export "Images werden exportiert" ;;
      *"Compiled successfully"*) write_progress 64 buildWeb "Web-Build kompiliert" ;;
      *"dockora-web Building"*|*" Building web"*) write_progress 52 buildWeb "Web-Image wird gebaut" ;;
      *"dockora-api Building"*|*" Building api"*) write_progress 38 buildApi "API-Image wird gebaut" ;;
    esac
    sleep 1
  done
}

echo "==> Dockora self-update"
echo "    dir=\${INSTALL_DIR} repo=\${REPO} branch=\${BRANCH} skip_compose=\${SKIP_COMPOSE}"
write_progress 4 start "Update gestartet"

if [ ! -f "\${INSTALL_DIR}/docker-compose.yml" ]; then
  echo "ERROR: docker-compose.yml missing in \${INSTALL_DIR}" >&2
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
  printf '%s' "$1" | tr -d '\\n' | sed -n 's/.*"sha"[[:space:]]*:[[:space:]]*"\\([a-f0-9]\\{40\\}\\)".*/\\1/p' | head -1
}

resolve_sha() {
  if command -v git >/dev/null 2>&1; then
    SHA="$(git ls-remote "$CLONE_URL" "refs/heads/\${BRANCH}" | awk '{print $1}' | head -1 || true)"
    if [ -n "\${SHA:-}" ]; then
      echo "$SHA"
      return 0
    fi
  fi
  AUTH_HEADER=""
  if [ -n "\${GITHUB_TOKEN:-}\${GH_TOKEN:-}" ]; then
    AUTH_HEADER="Authorization: Bearer \${GITHUB_TOKEN:-\${GH_TOKEN:-}}"
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
  tar cf - \\
    --exclude='./.env' \\
    --exclude='./data' \\
    --exclude='./.dockora-revision' \\
    --exclude='./.dockora-update-progress' \\
    --exclude='./.git' \\
    --exclude='./node_modules' \\
    --exclude='./apps/api/node_modules' \\
    --exclude='./apps/web/node_modules' \\
    --exclude='./apps/web/.next' \\
    . | (cd "$INSTALL_DIR" && tar xf -)
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Resolving remote revision"
write_progress 8 resolve "Remote-Revision wird gelesen"
ensure_git || true
SHA="$(resolve_sha)"
echo "    remote=$SHA"
write_progress 12 resolve "Remote-Revision ermittelt"

if [ -d "\${INSTALL_DIR}/.git" ] && ensure_git && sync_via_git; then
  echo "==> Git sync complete"
  SHA="$(git -C "$INSTALL_DIR" rev-parse HEAD)"
  write_progress 22 sync "Quellcode synchronisiert"
else
  write_progress 16 sync "Quellcode wird geladen"
  sync_via_tarball
  write_progress 22 sync "Quellcode synchronisiert"
fi

if [ "$SKIP_COMPOSE" = "1" ]; then
  printf '%s\\n' "$SHA" > "\${INSTALL_DIR}/.dockora-revision"
  echo "    wrote .dockora-revision"
  echo "==> Skip compose rebuild (host/dev mode)"
  write_progress 100 done "Dateien aktualisiert"
  echo "==> Done. Restart API/Web if they do not hot-reload."
  exit 0
fi

echo "==> Rebuilding stack (docker compose up -d --build)"
write_progress 28 build "Stack-Rebuild startet"
cd "$INSTALL_DIR"
PROFILES=""
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'dockora-proxy'; then
  PROFILES="--profile proxy"
fi
# shellcheck disable=SC2086
docker compose $PROFILES up -d --build --remove-orphans > "$TMP/compose.log" 2>&1 &
CPID=$!
watch_compose_log "$CPID" "$TMP/compose.log" &
WATCH=$!
set +e
wait "$CPID"
COMPOSE_RC=$?
set -e
kill "$WATCH" 2>/dev/null || true
wait "$WATCH" 2>/dev/null || true
cat "$TMP/compose.log" || true
if [ "$COMPOSE_RC" -ne 0 ]; then
  write_progress 0 error "Compose-Rebuild fehlgeschlagen"
  exit "$COMPOSE_RC"
fi

# Nginx resolves upstream IPs at start; force-recreate so a stale web/api IP cannot 502
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'dockora-proxy'; then
  echo "==> Refreshing proxy (pick up new api/web IPs + nginx.conf)"
  write_progress 93 proxy "Proxy wird aktualisiert"
  # shellcheck disable=SC2086
  docker compose $PROFILES up -d --force-recreate --no-deps proxy
fi

# Only mark deployed after a successful rebuild
printf '%s\\n' "$SHA" > "\${INSTALL_DIR}/.dockora-revision"
echo "    wrote .dockora-revision"
write_progress 95 finalize "Revision gespeichert"

echo "==> Pruning Docker build cache"
write_progress 97 finalize "Build-Cache wird bereinigt"
docker builder prune -af || true
echo "==> Pruning dangling images"
docker image prune -f || true

write_progress 100 done "Update abgeschlossen"
echo "==> Done. Dockora should come back shortly."
`;
