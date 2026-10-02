#!/bin/sh
# Installs the host metrics collector. Run on the host, not in a container.
# Writes /opt/dockora/run/host-proc.snap and keeps a systemd service running.
set -eu

INSTALL_DIR="${DOCKORA_INSTALL_DIR:-/opt/dockora}"
RUN="${INSTALL_DIR}/run"
SNAP="${RUN}/host-proc.snap"
UNIT="/etc/systemd/system/dockora-host-metrics.service"

mkdir -p "$RUN"
HOST_PROC_SNAP="$SNAP" HOST_PROC_ONCE=1 sh "${INSTALL_DIR}/scripts/host-proc-agent.sh"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "WARN: systemd is missing; wrote ${SNAP} once" >&2
  exit 0
fi

cat > "$UNIT" <<EOF
[Unit]
Description=Dockora host metrics
After=local-fs.target

[Service]
Type=simple
Environment=HOST_PROC_SNAP=${SNAP}
Environment=DOCKORA_INSTALL_DIR=${INSTALL_DIR}
ExecStart=/bin/sh ${INSTALL_DIR}/scripts/host-proc-agent.sh
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now dockora-host-metrics.service
echo "host metrics -> ${SNAP}"
