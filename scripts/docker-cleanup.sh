#!/usr/bin/env bash
# Daily Docker housekeeping for Dockora hosts (safety net).
# Build cache is also pruned by the API (scheduler cleanup / healthcheck threshold / compose build).
# Safe: keeps running containers/images/volumes; clears BuildKit cache + dangling objects.
set -euo pipefail

LOG_TAG="${LOG_TAG:-dockora-docker-cleanup}"
log() { printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "docker not found – skip"
  exit 0
fi

BEFORE="$(df -PB1 / | awk 'NR==2 {print $3}')"
log "start (used_bytes_before=${BEFORE})"

# Main space hog on Compose-build installs
docker builder prune -af

# Dangling images/networks/stopped containers only (no -a, no --volumes)
docker system prune -f

# Optional small host caches
apt-get clean >/dev/null 2>&1 || true
rm -rf /root/.cache/pnpm /root/.npm/_cacache 2>/dev/null || true

AFTER="$(df -PB1 / | awk 'NR==2 {print $3}')"
FREED=$(( BEFORE > AFTER ? BEFORE - AFTER : 0 ))
log "done (used_bytes_after=${AFTER} freed_bytes=${FREED})"

# Also emit a one-line journal-friendly summary
logger -t "$LOG_TAG" "freed_bytes=${FREED}" || true
