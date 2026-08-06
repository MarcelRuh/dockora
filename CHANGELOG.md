# Changelog

All notable changes to this project are documented here.
Detailed history also lives in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## [1.2.2] – 2026-08-06

### Fixed

- Dashboard shows Docker Compose version in the API container (host CLI mount + host-agent fallback)
- Align running image `APP_VERSION` with GitHub release tags

## [1.2.1] – 2026-08-06

### Added

- Host-proc agent for correct LXC/guest RAM & CPU under Docker-in-LXC
- `DOCKER_GID` / `group_add` so the API can access the Docker socket
- OCI source labels on Docker images for GHCR package linking

### Fixed

- Hide Dockora’s own containers, images, and compose project from management views (Monitoring still shows them)
- Image filter now matches registry refs like `ghcr.io/.../dockora-api` and suite-only images (e.g. proxy nginx)

## [1.2.0] – 2026-08-06

### Added

- Optional GHCR image install (`DOCKORA_USE_IMAGES=1` / `docker-compose.images.yml`)
- Clear login banner at end of `install.sh` (URL, email, password)
- Self-update UI waits for API health before reload
- Plugin enable/disable in Settings → Plugins
- CI API smoke job (`scripts/e2e-smoke.sh`)
- Release-notes workflow syncs GitHub Release body from CHANGELOG
- `scripts/make-ghcr-public.sh` to publish GHCR packages

### Fixed

- (carried from 1.1.x) prune unused, self-update hang, gitignore module tracking

## [1.1.0] – 2026-08-06

### Added

- In-app Compose self-update: GitHub revision check + one-shot updater (`Settings → Updates`)
- Host updater script: `scripts/update.sh` / `scripts/self-update-apply.sh` (wget one-liner)
- Installer writes `.dockora-revision` and `DOCKORA_INSTALL_DIR` for seamless updates
- wget one-line installer (`scripts/install.sh`)

### Fixed

- Self-update no longer sticks on “Update läuft…” (progress from updater container / host apply)
- Auto-detect install directory in development
- Image prune “all unused” now uses `dangling=false` (same as `docker image prune -a`)
- Source modules `backups` / `logs` were accidentally gitignored – restored for CI builds

### Removed

- Dashboard Lifetime Peaks / Container Lifetime tracking UI and background sampler

## [1.0.0] – 2026-08-05

### Added

- Full Docker management suite: dashboard, containers, terminal, compose, images, updates, backups, monitoring, logs, settings
- JWT auth with roles (admin / operator / viewer), login lockout, production secret enforcement
- Compose `.env` editor, digest-pinned update/rollback, volume backups
- SSE streaming proxies + optional nginx same-origin profile
- Self-update check/pull via `DOCKORA_SELF_IMAGE`
- Filesystem plugin loader (`plugins/<name>/index.js`)
- Discord notifications, scheduler, audit log
- OpenAPI UI at `/api/docs`
- GitHub CI, Dependabot, Docker publish to GHCR

### Security

- Masked Discord webhooks in API responses and backups
- Rate limits on destructive compose actions and login
- Weak JWT / bootstrap passwords rejected when `NODE_ENV=production`

## [0.3.0] – Dashboard UI

## [0.2.0] – Dashboard API

## [0.1.0] – Project scaffold
