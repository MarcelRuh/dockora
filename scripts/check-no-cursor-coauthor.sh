#!/usr/bin/env bash
# Fail if any commit in range contains Cursor co-author trailer.
set -euo pipefail
RANGE="${1:-HEAD~20..HEAD}"
if git log --format='%B' "$RANGE" 2>/dev/null | grep -q 'Co-authored-by: Cursor <cursoragent@cursor.com>'; then
  echo "ERROR: Commit messages must not include Co-authored-by: Cursor" >&2
  git log --format='%h %s' "$RANGE" --grep='Co-authored-by: Cursor' >&2 || true
  exit 1
fi
echo "OK: no Cursor co-author trailers in $RANGE"
