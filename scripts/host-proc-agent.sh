#!/bin/sh
# Schreibt periodisch LXC-/Host-/proc nach /data/host-proc.snap (Docker-in-LXC).
# Benötigt: pid: host + CAP_SYS_ADMIN + CAP_SYS_PTRACE
set -eu
OUT="${HOST_PROC_SNAP:-/data/host-proc.snap}"
TMP="${OUT}.tmp"
INTERVAL="${HOST_PROC_INTERVAL_SEC:-10}"
# docker compose version is relatively expensive – refresh less often
COMPOSE_INTERVAL="${HOST_PROC_COMPOSE_INTERVAL_SEC:-60}"
COMPOSE_CACHE=""
LAST_COMPOSE=0

while true; do
  NOW=$(date +%s)
  if [ $((NOW - LAST_COMPOSE)) -ge "$COMPOSE_INTERVAL" ] || [ -z "$COMPOSE_CACHE" ]; then
    COMPOSE_CACHE=$(nsenter -t 1 -m sh -c '
      (/usr/bin/docker compose version --short 2>/dev/null || /usr/local/bin/docker compose version --short 2>/dev/null || true)
    ' 2>/dev/null || true)
    LAST_COMPOSE=$NOW
  fi

  if nsenter -t 1 -m sh -c '
    cat /proc/meminfo
    echo "----STAT----"
    cat /proc/stat
    echo "----DF----"
    df -B1 -P / 2>/dev/null | tail -1
  ' >"$TMP" 2>/dev/null; then
    {
      cat "$TMP"
      echo "----COMPOSE----"
      printf '%s\n' "$COMPOSE_CACHE"
    } >"${TMP}.out"
    mv "${TMP}.out" "$OUT"
    rm -f "$TMP"
  else
    rm -f "$TMP" "${TMP}.out"
  fi
  sleep "$INTERVAL"
done
