#!/bin/sh
# Drop BuildKit/compose build cache after image builds.
# Safe: does not remove tagged images, containers, or volumes.
set -eu

if ! command -v docker >/dev/null 2>&1; then
  exit 0
fi

echo "==> Pruning Docker build cache"
docker builder prune -af
echo "==> Pruning dangling images"
docker image prune -f
