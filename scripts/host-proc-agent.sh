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
    echo "----TEMP----"
    pref=""
    other=""
    for z in /sys/class/thermal/thermal_zone*; do
      [ -r "$z/temp" ] || continue
      typ=$(cat "$z/type" 2>/dev/null || echo "")
      val=$(cat "$z/temp" 2>/dev/null || echo "")
      case "$val" in
        ""|*[!0-9]*) continue ;;
      esac
      case "$typ" in
        *pkg*|*x86*|*cpu*|*core*) pref=$val ;;
        acpitz|ACPI*|acpi*) ;;
        *) [ -n "$other" ] || other=$val ;;
      esac
    done
    if [ -n "$pref" ]; then
      printf "%s\n" "$pref"
    else
      max=""
      for d in /sys/class/hwmon/hwmon*; do
        [ -d "$d" ] || continue
        name=$(cat "$d/name" 2>/dev/null || echo "")
        case "$name" in
          coretemp|k10temp|zenpower|k8temp|cpu*) ;;
          *) continue ;;
        esac
        for f in "$d"/temp*_input; do
          [ -r "$f" ] || continue
          val=$(cat "$f" 2>/dev/null || echo "")
          case "$val" in
            ""|*[!0-9]*) continue ;;
          esac
          if [ -z "$max" ] || [ "$val" -gt "$max" ]; then max=$val; fi
        done
      done
      if [ -n "$max" ]; then
        printf "%s\n" "$max"
      elif [ -n "$other" ]; then
        printf "%s\n" "$other"
      fi
    fi
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
