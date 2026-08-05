# Changelog

All notable changes to this project are documented here.
Detailed history also lives in [docs/CHANGELOG.md](./docs/CHANGELOG.md).

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
