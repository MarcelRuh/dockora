#!/usr/bin/env bash
# Dockora one-line installer (wget / curl friendly)
#
# Usage:
#   wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | bash
#
# Options (env):
#   DOCKORA_DIR=/opt/dockora          Installationsverzeichnis
#   DOCKORA_BRANCH=main              Git-Branch
#   DOCKORA_SKIP_START=1             Nur klonen/konfigurieren, nicht starten
#   DOCKORA_PROXY=1                  nginx Same-Origin-Proxy-Profil mitstarten
#   DOCKORA_USE_IMAGES=1             GHCR-Images statt lokalem Build
#   DOCKORA_IMAGE_TAG=1.1.0          Tag für GHCR-Images (default: latest)
#   JWT_SECRET=...                   sonst wird generiert
#   BOOTSTRAP_ADMIN_PASSWORD=...     sonst wird generiert (einmal angezeigt)

set -euo pipefail

REPO_SSH="git@github.com:MarcelRuh/dockora.git"
REPO_HTTPS="https://github.com/MarcelRuh/dockora.git"
BRANCH="${DOCKORA_BRANCH:-main}"
INSTALL_DIR="${DOCKORA_DIR:-/opt/dockora}"
PROXY="${DOCKORA_PROXY:-0}"
SKIP_START="${DOCKORA_SKIP_START:-0}"
USE_IMAGES="${DOCKORA_USE_IMAGES:-0}"
IMAGE_TAG="${DOCKORA_IMAGE_TAG:-latest}"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
info() { printf '==> %s\n' "$*"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    red "Missing required command: $1"
    exit 1
  fi
}

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

info "Dockora installer"
info "Target: ${INSTALL_DIR} (branch ${BRANCH})"

need_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  red "docker compose plugin is required (Docker Compose V2)"
  exit 1
fi

if command -v git >/dev/null 2>&1; then
  CLONE_OK=1
else
  CLONE_OK=0
  need_cmd wget
  need_cmd tar
fi

if [[ "$(id -u)" -ne 0 ]]; then
  yellow "Not running as root – ensure write access to ${INSTALL_DIR} and Docker socket."
fi

mkdir -p "$(dirname "$INSTALL_DIR")"

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing git checkout – pulling ${BRANCH}"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [[ -d "$INSTALL_DIR" ]] && [[ -f "${INSTALL_DIR}/docker-compose.yml" ]]; then
  info "Existing install directory found – skipping clone"
else
  if [[ "$CLONE_OK" -eq 1 ]]; then
    info "Cloning repository"
    if git clone --depth 1 --branch "$BRANCH" "$REPO_HTTPS" "$INSTALL_DIR" 2>/dev/null; then
      true
    else
      git clone --depth 1 --branch "$BRANCH" "$REPO_SSH" "$INSTALL_DIR"
    fi
  else
    info "git not found – downloading tarball via wget"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    ARCHIVE="${TMP}/dockora.tar.gz"
    wget -qO "$ARCHIVE" "https://github.com/MarcelRuh/dockora/archive/refs/heads/${BRANCH}.tar.gz"
    mkdir -p "$INSTALL_DIR"
    tar -xzf "$ARCHIVE" -C "$TMP"
    # github archive extracts to dockora-<branch>
    SRC="$(find "$TMP" -maxdepth 1 -type d -name 'dockora-*' | head -1)"
    if [[ -z "$SRC" ]]; then
      red "Failed to extract Dockora archive"
      exit 1
    fi
    # copy contents into install dir
    shopt -s dotglob
    mv "$SRC"/* "$INSTALL_DIR"/
    shopt -u dotglob
  fi
fi

cd "$INSTALL_DIR"

# portable in-place replace (GNU/BSD sed)
replace_env() {
  local key="$1" value="$2" file=".env"
  if grep -q "^${key}=" "$file"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

if [[ ! -f .env ]]; then
  info "Creating .env from .env.example"
  cp .env.example .env

  JWT_SECRET="${JWT_SECRET:-$(rand_hex)}"
  BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:-$(rand_hex)}"
  # trim password to 24 chars for readability while staying strong
  BOOTSTRAP_ADMIN_PASSWORD="${BOOTSTRAP_ADMIN_PASSWORD:0:24}"
  BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@dockora.local}"

  replace_env JWT_SECRET "$JWT_SECRET"
  replace_env BOOTSTRAP_ADMIN_PASSWORD "$BOOTSTRAP_ADMIN_PASSWORD"
  replace_env BOOTSTRAP_ADMIN_EMAIL "$BOOTSTRAP_ADMIN_EMAIL"

  green "Generated secrets written to ${INSTALL_DIR}/.env"
  NEW_INSTALL=1
else
  info ".env already exists – leaving secrets unchanged"
  NEW_INSTALL=0
  BOOTSTRAP_ADMIN_EMAIL="$(grep -E '^BOOTSTRAP_ADMIN_EMAIL=' .env | head -1 | cut -d= -f2- || true)"
  BOOTSTRAP_ADMIN_PASSWORD="$(grep -E '^BOOTSTRAP_ADMIN_PASSWORD=' .env | head -1 | cut -d= -f2- || true)"
  BOOTSTRAP_ADMIN_EMAIL="${BOOTSTRAP_ADMIN_EMAIL:-admin@dockora.local}"
fi

replace_env DOCKORA_IMAGE_TAG "$IMAGE_TAG"

# Docker-Socket-Gruppe am Host (sonst EACCES im API-Container)
if command -v getent >/dev/null 2>&1; then
  DOCKER_GID_DETECTED="$(getent group docker 2>/dev/null | cut -d: -f3 || true)"
fi
replace_env DOCKER_GID "${DOCKER_GID:-${DOCKER_GID_DETECTED:-999}}"

# Always keep install-dir / repo wiring for in-app self-update
replace_env DOCKORA_INSTALL_DIR "$INSTALL_DIR"
replace_env DOCKORA_REPO "${DOCKORA_REPO:-MarcelRuh/dockora}"
replace_env DOCKORA_UPDATE_BRANCH "$BRANCH"
rm -f .env.bak

info "Recording installed revision"
resolve_remote_sha() {
  local repo="$1" branch="$2" sha=""
  if command -v git >/dev/null 2>&1; then
    sha="$(git ls-remote "https://github.com/${repo}.git" "refs/heads/${branch}" | awk '{print $1}' | head -1 || true)"
  fi
  if [[ -z "$sha" ]]; then
    sha="$(wget -qO- --header='User-Agent: git/2.43.0' \
      "https://github.com/${repo}.git/info/refs?service=git-upload-pack" \
      | tr -d '\000' \
      | grep -oE "[0-9a-f]{40}[[:space:]]+refs/heads/${branch}" \
      | awk '{print $1}' | head -1 || true)"
  fi
  if [[ -z "$sha" ]]; then
    sha="$(wget -qO- --header='User-Agent: dockora-install' \
      "https://github.com/${repo}/commits/${branch}.atom" \
      | sed -n 's/.*Grit::Commit\/\([a-f0-9]\{40\}\).*/\1/p' | head -1 || true)"
  fi
  printf '%s' "$sha"
}

if [[ -d .git ]] && command -v git >/dev/null 2>&1; then
  git rev-parse HEAD >.dockora-revision
else
  REV="$(resolve_remote_sha "${DOCKORA_REPO:-MarcelRuh/dockora}" "$BRANCH")"
  if [[ -n "${REV:-}" ]]; then
    printf '%s\n' "$REV" >.dockora-revision
  else
    yellow "Could not resolve git revision – self-update will treat first check as update-available"
  fi
fi
if [[ -f .dockora-revision ]]; then
  info "Revision: $(tr -d '\n' <.dockora-revision | cut -c1-12)"
fi
chmod +x scripts/*.sh 2>/dev/null || true

# Weekly Docker build-cache cleanup (BuildKit can grow tens of GB)
install_docker_cleanup_timer() {
  if [[ ! -d /run/systemd/system ]] || ! command -v systemctl >/dev/null 2>&1; then
    return 0
  fi
  local unit_dir="${INSTALL_DIR}/packaging/systemd"
  if [[ ! -f "${unit_dir}/dockora-docker-cleanup.service" || ! -f "${unit_dir}/dockora-docker-cleanup.timer" ]]; then
    return 0
  fi
  # Resolve script path inside unit for non-/opt installs
  local svc_tmp
  svc_tmp="$(mktemp)"
  sed "s|/opt/dockora/scripts/docker-cleanup.sh|${INSTALL_DIR}/scripts/docker-cleanup.sh|g" \
    "${unit_dir}/dockora-docker-cleanup.service" >"$svc_tmp"
  install -m 0644 "$svc_tmp" /etc/systemd/system/dockora-docker-cleanup.service
  rm -f "$svc_tmp"
  install -m 0644 "${unit_dir}/dockora-docker-cleanup.timer" /etc/systemd/system/dockora-docker-cleanup.timer
  systemctl daemon-reload
  systemctl enable --now dockora-docker-cleanup.timer >/dev/null
  info "Enabled weekly Docker cleanup timer (Sun ~03:30)"
}
install_docker_cleanup_timer

if [[ "$SKIP_START" == "1" ]]; then
  green "Skip start requested. Configure ${INSTALL_DIR}/.env then run:"
  if [[ "$USE_IMAGES" == "1" ]]; then
    echo "  cd ${INSTALL_DIR} && docker compose -f docker-compose.yml -f docker-compose.images.yml up -d"
  else
    echo "  cd ${INSTALL_DIR} && docker compose up -d --build"
  fi
  exit 0
fi

COMPOSE=(docker compose -f docker-compose.yml)
if [[ "$USE_IMAGES" == "1" ]]; then
  COMPOSE+=(-f docker-compose.images.yml)
  info "Using GHCR images (tag ${IMAGE_TAG})"
  "${COMPOSE[@]}" pull
  if [[ "$PROXY" == "1" ]]; then
    "${COMPOSE[@]}" --profile proxy up -d
  else
    "${COMPOSE[@]}" up -d
  fi
else
  info "Building and starting containers"
  if [[ "$PROXY" == "1" ]]; then
    docker compose --profile proxy up -d --build
  else
    docker compose up -d --build
  fi
  # BuildKit layers accumulate fast (~GBs per Dockora rebuild)
  if [[ -x "${INSTALL_DIR}/scripts/prune-build-cache.sh" ]]; then
    "${INSTALL_DIR}/scripts/prune-build-cache.sh" || true
  else
    docker builder prune -af || true
  fi
  docker image prune -f || true
fi

if [[ "$PROXY" == "1" ]]; then
  WEB_HINT="http://$(hostname -f 2>/dev/null || echo localhost):${DOCKORA_PROXY_PORT:-8080}"
else
  WEB_HINT="http://$(hostname -f 2>/dev/null || echo localhost):${DOCKORA_WEB_PORT:-3000}"
fi

green "Dockora is starting."
echo
echo "┌──────────────────────────────────────────────┐"
echo "│  Login                                       │"
echo "├──────────────────────────────────────────────┤"
echo "│  UI:       ${WEB_HINT}"
echo "│  E-Mail:   ${BOOTSTRAP_ADMIN_EMAIL}"
if [[ "$NEW_INSTALL" == "1" ]]; then
  echo "│  Passwort: ${BOOTSTRAP_ADMIN_PASSWORD}"
else
  echo "│  Passwort: (siehe ${INSTALL_DIR}/.env)"
fi
echo "│  Dir:      ${INSTALL_DIR}"
echo "└──────────────────────────────────────────────┘"
echo
if [[ "$NEW_INSTALL" == "1" ]]; then
  yellow "Passwort jetzt speichern – es wird nicht erneut angezeigt."
fi
echo "  API:    http://localhost:${DOCKORA_API_PORT:-3001}/api/v1/health"
echo "  Logs:   docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f"
