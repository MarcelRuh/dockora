#!/bin/sh
# Runs as root, then drops to dockora.
# Makes standard Compose roots writable (API user cannot mkdir under root-owned /home).
set -eu

mkdir -p /data /data/compose /home /srv

chown -R dockora:dockora /data 2>/dev/null || true

# Dedicated compose roots – safe to own on a Dockora host/LXC
for dir in /home /srv /data/compose; do
  if [ -d "$dir" ]; then
    if chown dockora:dockora "$dir" 2>/dev/null; then
      chmod 755 "$dir" 2>/dev/null || true
    else
      # Fallback: sticky world-writable (like /tmp) so create still works
      chmod 1777 "$dir" 2>/dev/null || true
    fi
  fi
done

cd /app/apps/api
exec runuser -u dockora -- sh -c \
  'node ./node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js'
