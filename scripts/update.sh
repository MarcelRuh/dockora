#!/usr/bin/env bash
# Dockora host-side updater (CLI counterpart to Settings → Self-Update)
#
# Usage:
#   wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/update.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/update.sh | bash
#
# Env:
#   DOCKORA_DIR=/opt/dockora
#   DOCKORA_BRANCH=main
#   DOCKORA_REPO=MarcelRuh/dockora

set -euo pipefail

REPO="${DOCKORA_REPO:-MarcelRuh/dockora}"
BRANCH="${DOCKORA_BRANCH:-${DOCKORA_UPDATE_BRANCH:-main}}"
INSTALL_DIR="${DOCKORA_DIR:-${DOCKORA_INSTALL_DIR:-/opt/dockora}}"

export DOCKORA_INSTALL_DIR="$INSTALL_DIR"
export DOCKORA_REPO="$REPO"
export DOCKORA_UPDATE_BRANCH="$BRANCH"

if [[ -f "${INSTALL_DIR}/scripts/self-update-apply.sh" ]]; then
  exec sh "${INSTALL_DIR}/scripts/self-update-apply.sh"
fi

# First-time / wget pipe: fetch apply script into a temp file
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
wget -qO "$TMP" "https://raw.githubusercontent.com/${REPO}/${BRANCH}/scripts/self-update-apply.sh"
chmod +x "$TMP"
exec sh "$TMP"
