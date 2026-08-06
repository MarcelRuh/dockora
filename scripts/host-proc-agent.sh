#!/bin/sh
# Schreibt periodisch LXC-/Host-/proc nach /data/host-proc.snap (Docker-in-LXC).
# Benötigt: pid: host + CAP_SYS_ADMIN + CAP_SYS_PTRACE
set -eu
OUT="${HOST_PROC_SNAP:-/data/host-proc.snap}"
TMP="${OUT}.tmp"
INTERVAL="${HOST_PROC_INTERVAL_SEC:-2}"

while true; do
  if nsenter -t 1 -m sh -c 'cat /proc/meminfo; echo "----STAT----"; cat /proc/stat; echo "----DF----"; df -B1 -P / 2>/dev/null | tail -1' >"$TMP" 2>/dev/null; then
    mv "$TMP" "$OUT"
  else
    rm -f "$TMP"
  fi
  sleep "$INTERVAL"
done
