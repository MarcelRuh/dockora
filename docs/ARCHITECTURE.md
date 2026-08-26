# Architektur – Dockora

## Prinzipien

- **Clean Architecture** – Domain ohne Framework-Abhängigkeiten
- **SOLID** – klare Verantwortlichkeiten, Interfaces (Ports)
- **Modulare Feature-Module** – jedes Modul unabhängig erweiterbar
- **Explizite DI** – Dependencies werden durchgereicht, kein Magic-Container
- **Shared Contracts** – API-Shapes leben in `@dockora/shared`

## Schichten (API)

```
presentation/     HTTP-Routes, Hooks, Error-Handler
modules/          Feature-Module (register als Fastify-Plugins)
application/      Use-Cases / Orchestrierung (folgt)
domain/           Entities, Ports (Interfaces)
infrastructure/   Dockerode, Prisma, Discord, FS, Logger
config/           Env-Validierung (Zod)
```

## Request-Flow

```
Client → Fastify (Helmet, CORS, Rate-Limit)
      → Modul-Route
      → Service / Use-Case
      → Port (Interface)
      → Adapter (Dockerode, Prisma, …)
```

## Docker-Integration

- Socket-Pfad aus `DOCKER_SOCKET` (Default `/var/run/docker.sock`)
- Fehlt der Socket → `OfflineDockerClient` (kein Crash)
- Events: Stream über Dockerode, Buffer im Prozess (Reconnect nach 5s)
- Compose-Version: CLI (`docker compose` / `docker-compose`) – bewusst Ausnahme

## DI (Fastify Decorators)

| Decorator | Typ |
|-----------|-----|
| `app.config` | `AppConfig` |
| `app.docker` | `IDockerClient` |
| `app.hostMetrics` | `IHostMetrics` |
## Frontend

- Next.js App Router
- Dark-only UI via `class="dark"` + CSS-Variablen
- i18n: DE/EN (leichtgewichtiger Provider; später next-intl möglich)
- API-Proxy über Next.js Rewrites (`/api/v1/*` → Backend) für REST
- Dashboard/Log Live-Updates: **SSE** über dedizierte Next Route-Handler
  (`/api/v1/dashboard/stream`, `/api/v1/containers/:id/logs/stream`) – kein Rewrite-Buffering
- Produktion: Reverse-Proxy-Profil `proxy` (`deploy/nginx.conf`, `proxy_buffering off`)
  für Same-Origin inkl. WebSocket-Upgrade
- Fallback Dev: `NEXT_PUBLIC_API_HTTP` / `NEXT_PUBLIC_API_WS` direkt auf API-Port

## Sicherheit

| Thema | Status |
|-------|--------|
| Helmet | aktiv |
| Rate Limiting | aktiv |
| CORS | konfigurierbar (`credentials: true`) |
| JWT / Auth | HttpOnly-Cookie `dockora_session` + CSRF double-submit; Bearer weiter für API-Clients. `Secure` nur bei HTTPS (`X-Forwarded-Proto`), nicht pauschal bei `NODE_ENV=production`. |
| CSRF | `X-CSRF-Token` muss zum Cookie `dockora_csrf` passen (Cookie-Sessions, unsichere Methoden) |
| HTTPS | Compose-Profile `tls` / `proxy` |
| Docker Socket | Env-Pfad, Rechte am Host |

## Plugin-System

`DockoraPlugin` Interface in `domain/ports.ts` – Registry folgt im Plugins-Modul.

## Datenbank

Prisma + SQLite. Schema enthält vorerst: `User`, `Setting`, `Notification`, `AuditLog`.  
Migration auf PostgreSQL durch Provider-Wechsel in `schema.prisma` möglich.
