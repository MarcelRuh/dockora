# Module

## API-Module (`apps/api/src/modules`)

| Modul | Endpoints (Auszug) |
|-------|-------------------|
| openapi | `/api/docs` |
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

## Web-Routen

`/`, `/containers`, `/containers/[id]`, `/compose`, `/compose/new`, `/compose/[id]`, `/images`, `/volumes`, `/updates`, `/monitoring`, `/network`, `/backups`, `/logs`, `/terminal`, `/settings`
