#!/usr/bin/env bash
# Macht GHCR-Packages öffentlich (einmalig nach erstem Publish).
# Benötigt Token-Scopes: read:packages, write:packages
#
#   gh auth refresh -h github.com -s read:packages,write:packages
#   ./scripts/make-ghcr-public.sh

set -euo pipefail

OWNER="${DOCKORA_GHCR_OWNER:-$(gh api user -q .login | tr '[:upper:]' '[:lower:]')}"
PACKAGES=("dockora-api" "dockora-web")

for pkg in "${PACKAGES[@]}"; do
  echo "==> Set ${OWNER}/${pkg} visibility=public"
  gh api --method PUT \
    "/user/packages/container/${pkg}/visibility" \
    -f visibility=public \
    && echo "    OK" \
    || echo "    FAILED (package missing or token lacks packages scope)"
done

echo
echo "Link packages to repo MarcelRuh/dockora (optional):"
echo "  GitHub → Packages → Package settings → Repository source"
echo "Done."
