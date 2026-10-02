#!/bin/sh
# Schreibt periodisch Host-/proc nach /data/host-proc.snap.
# pid:host reicht, um PID 1 zu sehen. Lesen von /proc/1/root braucht CAP_SYS_PTRACE.
# CAP_SYS_ADMIN und nsenter sind nicht nötig; Bind-Mounts von /proc lügen in LXC
# (MemAvailable zeigt dann den Hypervisor).
set -eu
OUT="${HOST_PROC_SNAP:-/data/host-proc.snap}"
TMP="${OUT}.tmp"
INTERVAL="${HOST_PROC_INTERVAL_SEC:-10}"
ONCE="${HOST_PROC_ONCE:-0}"
HOST="/proc/1/root"

while true; do
  if cat "$HOST/proc/meminfo" >"$TMP" 2>/dev/null; then
    {
      echo "----STAT----"
      cat "$HOST/proc/stat"
      echo "----DF----"
      df -B1 -P "$HOST" 2>/dev/null | tail -1
      echo "----TEMP----"
      pref=""
      other=""
      for z in "$HOST"/sys/class/thermal/thermal_zone*; do
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
        for d in "$HOST"/sys/class/hwmon/hwmon*; do
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
    } >>"$TMP"
    mv "$TMP" "$OUT"
  else
    rm -f "$TMP"
  fi
  if [ "$ONCE" = "1" ]; then
    break
  fi
  sleep "$INTERVAL"
done
