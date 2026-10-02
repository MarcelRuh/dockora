#!/usr/bin/env bash
# Dockora host-side updater.
#
# Usage (from an existing install, no remote shell download):
#   sh /opt/dockora/scripts/self-update-apply.sh
#   DOCKORA_DIR=/opt/dockora bash /opt/dockora/scripts/update.sh
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

APPLY="${INSTALL_DIR}/scripts/self-update-apply.sh"
if [[ ! -f "$APPLY" ]]; then
  echo "ERROR: $APPLY is missing. Refusing to download a remote shell script." >&2
  exit 1
fi
exec sh "$APPLY"
