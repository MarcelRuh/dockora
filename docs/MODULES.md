# Module

## API-Module (`apps/api/src/modules`)

| Modul | Endpoints (Auszug) |
|-------|-------------------|
| openapi | `/api/docs` (Auth erforderlich, wenn Auth aktiv) |
| health | `GET /api/v1/health` |
| system | `GET /api/v1/system/info` |
| auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, User-CRUD |
| dashboard | `GET /dashboard`, `GET /dashboard/stream` |
| containers | CRUD-Aktionen, logs, stats, SSE logs |
| terminal | `WS /containers/:id/terminal` |
| compose | discovery, create, actions, yaml, backup |
| images | list, pull, remove, prune |
| volumes | list, prune unused, remove, browse |
| updates | check, pull, count |
| backups | create, restore, cleanup |
| notifications | list, read, discord test |
| monitoring | `GET /monitoring` |
| logs | `GET /logs` |
| scheduler | jobs list/patch/run |
| settings | GET/PUT |
| plugins | `GET /plugins` |

## Rollen (API)

Wenn Auth aktiv ist, gilt: **Viewer nur lesen**. Mutationen brauchen `operator` oder `admin`. Unbekannte Aktionen sind fail-closed (`admin`).

| Bereich | Operator + Admin | Nur Admin |
|---------|------------------|-----------|
| Container | start, stop, restart, pause, unpause | kill, remove |
| Compose | create, yaml/env write, backup, up, restart, pull, build, recreate | down, delete, einzelnen Service entfernen |
| Images | pull | prune, remove |
| Volumes | — | prune, remove |
| Updates | check, apply pull | — |
| Backups | — | create, cleanup, delete, restore |
| Notifications | mark read | Discord-Test |
| Settings, User, Plugins, Self-Update, Host-Terminal, Audit, Scheduler-Patch | — | ja |
| Scheduler run, Container-Terminal | ja | — |

Restore schreibt Compose/Env-Dateien nur unter `COMPOSE_SEARCH_PATHS` (keine Zip-Slip-Pfade, keine Volume-Namen mit `/`).

## Web-Routen

`/`, `/containers`, `/containers/[id]`, `/compose`, `/compose/new`, `/compose/[id]`, `/images`, `/volumes`, `/updates`, `/self-update`, `/monitoring`, `/network`, `/backups`, `/logs`, `/terminal`, `/settings`
