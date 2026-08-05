# Dockora

**Docker management suite** focused on Compose stacks, image updates, backups, and Discord notifications.

[![CI](https://github.com/MarcelRuh/dockora/actions/workflows/ci.yml/badge.svg)](https://github.com/MarcelRuh/dockora/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

> Status: **v1.0.0** – feature-complete baseline for self-hosted production use.

## One-line install (wget)

Requires Docker + Compose V2. Installs to `/opt/dockora` by default and generates strong secrets.

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | bash
```

With same-origin proxy (SSE/WebSocket on port 8080):

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | DOCKORA_PROXY=1 bash
```

Custom directory:

```bash
wget -qO- https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | DOCKORA_DIR=/srv/dockora bash
```

Or with curl:

```bash
curl -fsSL https://raw.githubusercontent.com/MarcelRuh/dockora/main/scripts/install.sh | bash
```

## Features

- Live dashboard (CPU/RAM/disk, container counts, events)
- Container management (lifecycle, logs, stats, web terminal)
- Compose discovery & actions (up/down/pull/build, YAML + `.env` editor, backups)
- Image management & multi-registry update checker (Docker Hub, GHCR, Quay, …)
- Backups (compose/env/settings/volumes, retention, scheduler) with secret redaction
- Discord webhooks, monitoring thresholds, central logs
- JWT auth (admin/operator/viewer), audit log, OpenAPI at `/api/docs`
- Plugin drop-in loader + optional self-update (`DOCKORA_SELF_IMAGE`)

## Stack

| Layer | Tech |
|-------|------|
| Monorepo | pnpm + Turborepo |
| API | Node.js 22, TypeScript, Fastify, Dockerode, Prisma/SQLite |
| Web | Next.js 15, React 19, Tailwind CSS, xterm |

## Quick start (development)

**Requirements:** Node.js 22+, pnpm 9+, Docker (recommended)

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
mkdir -p data/backups

pnpm install
pnpm --filter @dockora/shared build
cd apps/api && pnpm exec prisma migrate deploy && cd ../..
pnpm dev
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API health | http://localhost:3001/api/v1/health |
| OpenAPI | http://localhost:3001/api/docs |

Default bootstrap admin (first empty DB only):

- Email: `admin@dockora.local`
- Password: `dockora-admin-change-me` → **change immediately**

## Production (Docker Compose)

```bash
git clone https://github.com/MarcelRuh/dockora.git
cd dockora
cp .env.example .env
# Set strong JWT_SECRET + BOOTSTRAP_ADMIN_PASSWORD
docker compose up -d --build
```

Recommended same-origin proxy (SSE + WebSocket):

```bash
docker compose --profile proxy up -d --build
# http://localhost:8080
```

Full operator guide: [docs/DEPLOY.md](./docs/DEPLOY.md)

### Data paths

| Purpose | Development | Docker |
|---------|-------------|--------|
| SQLite | `<repo>/data/dockora.db` | `/data/dockora.db` |
| Backups | `<repo>/data/backups` | `/data/backups` |

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | API + web in parallel |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript across packages |
| `pnpm test` | Unit tests |
| `pnpm smoke` | API smoke tests (server must be running) |

## Documentation

- [Deploy](./docs/DEPLOY.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Modules](./docs/MODULES.md)
- [Roadmap](./docs/ROADMAP.md)
- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)

## Security notes

- Dockora requires Docker socket access — treat it as a **privileged** control plane
- Production refuses weak `JWT_SECRET` / bootstrap passwords
- Prefer TLS termination in front of the proxy profile
- Report vulnerabilities privately — see [SECURITY.md](./SECURITY.md)

## License

[MIT](./LICENSE)
