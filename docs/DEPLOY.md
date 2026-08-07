# Deploying Dockora

## Quick production (Docker Compose)

```bash
git clone https://github.com/MarcelRuh/dockora.git
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
- Mount `COMPOSE_SEARCH_PATHS` **read-write** so Dockora can create Compose projects on disk
- Keep the install tree (`DOCKORA_INSTALL_DIR`) separate; self-update uses a one-shot writer

## Reverse proxy (external)

Point your TLS terminator at the `proxy` service (or `web` + `/api` → `api:3001` with WebSocket upgrade and `proxy_buffering off` for SSE). See `deploy/nginx.conf`.

### Fast path: GHCR images

```bash
cp .env.example .env
# set JWT_SECRET + BOOTSTRAP_ADMIN_PASSWORD
DOCKORA_IMAGE_TAG=1.1.0 docker compose -f docker-compose.yml -f docker-compose.images.yml up -d
```

Make packages public once (needs `read:packages,write:packages` on your `gh` token):

```bash
gh auth refresh -h github.com -s read:packages,write:packages
./scripts/make-ghcr-public.sh
```

## Upgrades

### In-app (Compose installs via `install.sh`)

1. Open **Settings → Updates → Dockora Self-Update** (admin)
2. Compare local vs GitHub revision, click **Jetzt aktualisieren**
3. A one-shot updater syncs the install dir (keeps `.env` / `data/`) and runs `docker compose up -d --build`

Requires `DOCKORA_INSTALL_DIR` (set automatically by `install.sh`) and the install path mounted into the API container (default in `docker-compose.yml`).

### CLI

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/update.sh | bash
# or: DOCKORA_DIR=/srv/dockora bash scripts/update.sh
```

### Image-based

1. Set `DOCKORA_SELF_IMAGE=ghcr.io/marcelruh/dockora-api:latest`
2. Use Self-Update to pull, then `docker compose up -d` to recreate

## Backups

Use the in-app Backups module or copy `/data/backups`. Settings archives intentionally omit Discord webhook secrets.

## Health

- `GET /api/v1/health`
- Compose healthcheck on the `api` service
