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

# Docker socket is typically root:docker (srw-rw----). Compose sets group_add to
# DOCKER_GID, but runuser drops those supplementary groups unless the user is
# also a member of a matching group in /etc/group.
if [ -S /var/run/docker.sock ]; then
  sock_gid="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || true)"
  if [ -n "${sock_gid}" ] && [ "${sock_gid}" != "0" ]; then
    if ! getent group "${sock_gid}" >/dev/null 2>&1; then
      groupadd -g "${sock_gid}" dockersock 2>/dev/null || true
    fi
    sock_grp="$(getent group "${sock_gid}" | cut -d: -f1 || true)"
    if [ -n "${sock_grp}" ]; then
      usermod -aG "${sock_grp}" dockora 2>/dev/null || true
    fi
  fi
fi

cd /app/apps/api
exec runuser -u dockora -- sh -c \
  'node ./node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js'
