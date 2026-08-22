# Security Policy – Dockora

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |
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
- Expose the UI only behind TLS (reverse proxy)
- Prefer `docker compose --profile proxy` for same-origin SSE/WebSocket
- Do not commit `.env` files or backup archives containing secrets
- Rotate Discord webhooks if they may have leaked
- Keep host and container images updated

## Known Trust Boundaries

- The API talks to the Docker Engine via the mounted socket — treat Dockora as a privileged control plane.
- Compose `.env` files and backup archives may contain sensitive values; protect filesystem permissions accordingly.
- JWT is Bearer-based (no cookie session / CSRF yet).
