# Changelog

All notable changes to this project are documented here.
Detailed history also lives in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## [Unreleased]

## [1.5.3] – 2026-08-09

### Improved

- Discord notifications list affected container names and use clearer embed fields (no more bare “N Container haben Updates”)
- Manual “Update prüfen” and successful apply also send `update.available` / `update.installed` notifications (same as scheduler)
- Lower idle load: host-agent 10s (compose version 60s), healthcheck every 15m, update-check every 2h, slower UI polls, cached `docker df`

### Fixed

- Updates confirm dialog closes immediately on confirm so the progress bar is visible
- Image updates keep the original tag (e.g. `:latest`) on recreate instead of pinning `Config.Image` to `@sha256:…`
- Temperature alerts use CPU package sensors and a configurable threshold (default **95 °C**)
- GHCR/LSCR update checks authenticate with the configured PAT first (anonymous 429s no longer skip the token) and stagger requests

## [1.5.2] – 2026-08-07

### Fixed

- Proxy 502 after api/web recreate: nginx re-resolves Docker DNS for upstreams; self-update force-recreates the proxy container

## [1.5.1] – 2026-08-07

### Fixed

- Compose validate/logs (and container logs) return JSON wrappers so the UI no longer fails with `Unexpected token … is not valid JSON` on YAML/text responses

## [1.5.0] – 2026-08-07

Finale Ops-Release: Host-Terminal, härtere Update-/Terminal-Pfade, zuverlässige Docker-Bereinigung und UX für Scheduler, Users und Backup-Restore.

### Added

- Host terminal in main nav (`/terminal`): admin-only shell via host-agent `nsenter` into the LXC/host namespaces
- Compose/container delete removes the project folder (compose.yaml, .env, local appdata) when the stack is gone
- Update apply returns structured result (`step`, `rolledBack`, prune stats); unused images pruned after successful update
- Backup restore dry-run preview with selective apply flags (files / settings / volumes)
- Scheduler: real `nextRunAt`, `lastError`, human-readable job labels
- Users: edit display name and optional password reset in Settings
- Plugin loader: path sandbox (realpath under PLUGIN_DIR), name allowlist, register timeout
- Destructive rate limits on container kill/remove, backups, and image prune
- Terminal: idle timeout (15m), message rate limit, JWT via Sec-WebSocket-Protocol
- Scheduler `cleanup` also prunes Docker build cache; healthcheck auto-prunes when build-cache threshold is exceeded

### Changed

- Default / systemd Docker cleanup schedule: weekly → daily (build cache fills quickly with rebuilds)

### Fixed

- Monitoring alert cooldown uses fingerprints so fluctuating CPU/disk numbers do not bypass dedup
- Build-cache prune via API now uses `POST /build/prune?all=true` (dockerode's `pruneBuilder` ignored `all`)

## [1.2.3] – 2026-08-07

### Added

- Login with optional TOTP two-factor authentication
- Official Dockora logo / favicon in nav and login
- Registry tokens for GHCR/LSCR update checks; compose preview, bulk actions, confirms, mobile drawer
- Monitoring: build-cache size + configurable disk/build-cache alert thresholds
- Automatic Docker build-cache (and dangling image) prune after install, self-update, and compose build

### Fixed

- Sidebar nav needed a second click after route changes (AppShell remount)
- Compose create errors were cleared by reload; `privileged` / `network_mode: host` allowed again
- Update checks failing as “manifest error” with invalid registry tokens (challenge + anonymous fallback)
- Create flow keeps form/YAML on start failure; sticky error/progress
- Update rows show the full registry error text

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
