# Security Policy – Dockora

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅        |
| 1.x     | ❌        |
| < 1.0   | ❌        |

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

1. Email the maintainers (see repository profile) **or** use GitHub **Private Vulnerability Reporting** (Security tab → Advisories).
2. Include:
   - Affected version / commit
   - Reproduction steps
   - Impact assessment (auth bypass, RCE, secret leak, …)
3. Allow reasonable time for a fix before public disclosure.

We aim to acknowledge reports within **7 days**.

## Hardening Checklist (Operators)

- Set a strong `JWT_SECRET` (≥ 32 random characters) in production
- Set a strong `BOOTSTRAP_ADMIN_PASSWORD` (≥ 12 characters, no defaults)
- Authentication is **on by default**; keep it enabled on any network-exposed instance
- Restrict Docker socket access; prefer rootless Docker where possible
- Keep `DOCKORA_API_BIND=127.0.0.1` unless another host must call the API directly. `X-Forwarded-For` is trusted only from loopback and private addresses. Login failures also count per account, so a new forwarded address does not reset the lock
- Leave `DOCKORA_HOST_TERMINAL` unset; set it to `1` only while you need a host shell
- `/home` is mounted read-only. Directories you edit from the UI are extra writable binds in `docker-compose.override.yml` (not committed). `/opt` and `/srv` stay read-only. The API entrypoint does not change their owner or mode
- Host metrics run in systemd (`dockora-host-metrics`) on the host, so the default stack has no `pid: host` and no extra capabilities. The host shell is a separate Compose profile `host-shell` and stays off unless you start it
- In-app self-update runs the script embedded in the API image. It does not download a shell script. The one-shot updater still mounts the Docker socket so it can rebuild the stack. That socket is the control plane: Dockora cannot manage containers without it
- The API drops `NET_RAW`, `MKNOD`, `AUDIT_WRITE`, `SYS_CHROOT` and `SETFCAP`. The web container drops every capability. Both set `no-new-privileges`
- Browser sessions use the HttpOnly cookie. WebSockets use `Sec-WebSocket-Protocol: dockora.jwt.<token>`. A `?token=` query is ignored
- Discord webhooks must be `https://discord.com/api/webhooks/…`. ntfy may use a LAN server; loopback and link-local addresses are rejected
- Set `DOCKORA_EMBED=1` only on HTTPS, and set `DOCKORA_FRAME_ANCESTORS` to the parent site
- Expose the UI only behind TLS (compose profile `tls`, or an external reverse proxy)
- Prefer `docker compose --profile tls` (Caddy) or `--profile proxy` (nginx HTTP) for same-origin SSE/WebSocket
- Do not commit `.env` files or backup archives containing secrets
- Rotate Discord webhooks if they may have leaked
- Keep host and container images updated

## Known Trust Boundaries

- The API talks to the Docker Engine via the mounted socket — treat Dockora as a privileged control plane.
- Compose `.env` files and backup archives may contain sensitive values; protect filesystem permissions accordingly.
- JWT session is an **HttpOnly cookie** (`dockora_session`) plus CSRF double-submit (`dockora_csrf` / `X-CSRF-Token`). The `Secure` flag is set only when the request is HTTPS (`X-Forwarded-Proto`), so HTTP installs keep a working login. Bearer JWT still works for API clients.
- `/api/docs` (OpenAPI UI) requires a valid session when authentication is enabled.
