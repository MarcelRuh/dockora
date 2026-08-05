# Deploying Dockora

## Quick production (Docker Compose)

```bash
git clone https://github.com/OWNER/dockora.git
cd dockora
cp .env.example .env
# Set JWT_SECRET and BOOTSTRAP_ADMIN_PASSWORD to strong values
docker compose up -d --build
```

- Web: `http://<host>:3000`
- API health: `http://<host>:3001/api/v1/health`

### Recommended: same-origin proxy (SSE + WebSocket)

```bash
docker compose --profile proxy up -d --build
# UI + API under http://<host>:8080
```

Set `CORS_ORIGIN` to the public URL (e.g. `https://dockora.example.com`).

## Environment (critical)

| Variable | Production requirement |
|----------|------------------------|
| `JWT_SECRET` | ≥ 32 random chars, not a template default |
| `BOOTSTRAP_ADMIN_PASSWORD` | ≥ 12 chars, not `dockora-admin-change-me` |
| `CORS_ORIGIN` | Exact browser origin |
| `COMPOSE_SEARCH_PATHS` | Host paths mounted into the API container |

The API **refuses to start** in `NODE_ENV=production` with weak JWT/bootstrap secrets.

## Volumes & permissions

- Persist `/data` (`dockora-data` volume) for SQLite + backups
- Mount the Docker socket read/write only if you accept the privilege model
- Mount compose search paths read-only where possible

## Reverse proxy (external)

Point your TLS terminator at the `proxy` service (or `web` + `/api` → `api:3001` with WebSocket upgrade and `proxy_buffering off` for SSE). See `deploy/nginx.conf`.

## Upgrades

1. `git pull` / new image tags from GHCR
2. `docker compose pull && docker compose up -d`
3. Or set `DOCKORA_SELF_IMAGE` and use **Settings → Updates → Self-Update**, then recreate the stack

## Backups

Use the in-app Backups module or copy `/data/backups`. Settings archives intentionally omit Discord webhook secrets.

## Health

- `GET /api/v1/health`
- Compose healthcheck on the `api` service
