# Changelog

All notable changes to this project are documented here.
Detailed history also lives in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

## [Unreleased]

## [1.9.0] – 2026-08-26

### Added

- HttpOnly session cookie + CSRF double-submit (JWT no longer stored in localStorage)
- Global search (Ctrl/⌘K) across pages, containers, compose projects and images
- Compose editor diagnostics: YAML errors, missing `image`/`build`, unset `${VAR}` from `.env`
- List search on Compose and Images pages
- API ESLint (typescript-eslint)

### Changed

- Plugin loader times out import/unregister and freezes the plugin contract
- Auth logout is a server endpoint that clears session cookies

### Security

- CSRF required for cookie-authenticated mutations; Bearer API clients are unchanged

## [1.8.1] – 2026-08-26

### Changed

- UI is dark-only: light theme, theme toggle, and settings theme field are removed

### Fixed

- Compose YAML formatter pretty-prints the whole document as block style (flow maps/lists included)

## [1.8.0] – 2026-08-22

### Added

- HTTPS install profile (`DOCKORA_TLS=1`) with Caddy: Let’s Encrypt or internal CA
- Volumes page: list, size, unused prune, read-only browse
- Dedicated Compose create page (`/compose/new`) with YAML, directory, `.env` editor, and up
- Compose `.env`: paste in Raw first; Fields is edit-only (no add-row)

## [1.7.7] – 2026-08-22

### Added

- Dashboard Engine/Compose update shows a live progress bar with the current step

## [1.7.6] – 2026-08-22

### Changed

- Dashboard spacing is looser again; notifications show title, message and time (4 items)

## [1.7.5] – 2026-08-22

### Changed

- Dashboard fits a single screen: tighter cards, no empty unhealthy panel, notifications capped at three

## [1.7.4] – 2026-08-22

### Added

- Dashboard Engine/Compose cards check for newer stable releases and let admins apply the host update in-place

## [1.7.3] – 2026-08-22

### Fixed

- Monitoring no longer lists `dockora-self-updater` or raises exited/unhealthy alerts for it
- Host CPU temperature is auto-detected (host-agent thermal/hwmon, plus sysfs mounts) so wget installs no longer show “—”

## [1.7.2] – 2026-08-22

### Changed

- Compose icon picker only offers Selfhst (Homarr button removed)

### Fixed

- Sidebar stays visible while scrolling long Compose pages

## [1.7.1] – 2026-08-22

### Fixed

- Self-update no longer shows a reverse version arrow (`1.7.0 → 1.6.2`) when GitHub’s branch `package.json` is cached stale; versions are compared and `package.json`/changelog are read at the commit SHA

## [1.7.0] – 2026-08-22

### Added

- Self-update shows changelog notes before applying an update
- Compose restart, redeploy and logs can target a single service
- Compose `.env` editor with key/value fields and password masking
- Unhealthy containers are listed and clickable on the dashboard and compose views
- Compose service icon field (URL or Homarr/Selfhst picker) writes `icon=`

## [1.6.2] – 2026-08-22

### Fixed

- Self-update progress bar no longer stays at 100% from the previous run
- wget/compose installs show `current → GitHub version` when an update is available

## [1.6.1] – 2026-08-22

### Changed

- Compose service icons use the `icon=` label (`- icon=https://…`); Arcane/Unraid/Homarr keys remain as fallbacks

## [1.6.0] – 2026-08-22

### Added

- Compose Redeploy (`up -d --force-recreate`) so YAML/.env changes apply without a separate down + up

## [1.5.5] – 2026-08-22

### Fixed

- Self-update / wget installs no longer hit GitHub REST `403` rate limits; revision checks use git-upload-pack and the commit atom feed first

## [1.5.4] – 2026-08-22

### Added

- Self-update shows a live progress bar (sync, image build, container start) while the stack rebuilds

## [1.5.3.5] – 2026-08-22

### Fixed

- GHCR image build: shared package no longer requires `@types/node`; Docker `RUN` groups `pnpm install` so the TypeScript build actually runs

## [1.5.3.4] – 2026-08-22

### Fixed

- GHCR/buildx: re-run `pnpm install` in the image build stage so workspace links and `@types/node` exist after source overlay

## [1.5.3.3] – 2026-08-22

### Fixed

- GHCR/buildx image build: TypeScript configs extend relative paths so `@dockora/tsconfig` resolves without pnpm symlinks

## [1.5.3.2] – 2026-08-22

### Fixed

- GHCR image build: keep workspace `node_modules` / `@dockora/tsconfig` when overlaying API and web sources (v1.5.3.1 publish failed)
- Self-update compared git HEAD to GitHub, so a clone that already matched `main` hid pending container rebuilds; it now uses `.dockora-revision` plus running vs source version
- Self-update writes `.dockora-revision` only after a successful compose rebuild, prefers git fast-forward, and caches GitHub SHA checks (optional `GITHUB_TOKEN`)

## [1.5.3.1] – 2026-08-22

### Improved

- Compose `up` / `down` / `recreate` use `--remove-orphans`; standalone recreate retries briefly on port races

### Fixed

- Login screen was missing on GitHub/Compose installs because `authEnabled` defaulted to off
- Port-conflict errors name the container that holds the host port (e.g. `dockora-web` on `:3000`)

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
