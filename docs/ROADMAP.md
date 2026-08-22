# Roadmap

| Phase | Modul | Status |
|------:|-------|--------|
| 0 | Projektstruktur | erledigt |
| 1 | Docker-Client + Dashboard API | erledigt |
| 2 | Dashboard UI | erledigt |
| 3 | Container-Verwaltung | erledigt |
| 4 | Web-Terminal | erledigt |
| 5–6 | Compose Discovery + Aktionen | erledigt |
| 7 | Images | erledigt |
| 8 | Update Checker | erledigt |
| 9 | Backups | erledigt |
| 10 | Notifications / Discord | erledigt |
| 11 | Scheduler | erledigt |
| 12 | Health Monitoring | erledigt |
| 13 | Logs-Zentrale | erledigt |
| 14 | Settings | erledigt |
| 15 | Auth & Rollen | erledigt |
| 16 | OpenAPI | erledigt |
| 17 | Plugin-System (Registry + FS-Loader) | erledigt |
| 18 | App Self-Update | erledigt (Compose/GitHub In-App + DOCKORA_SELF_IMAGE) |
| 19 | Hardening & erweiterte Tests | teilweise (Unit + Smoke + GitHub CI) |

## Bekannte Ausbaustufen

- ~~Rolling Updates mit Healthcheck/Rollback~~ (Standalone + Compose Digest-Pin)
- ~~Volume-Daten in Backups~~
- ~~Compose `.env` in Detail-UI~~
- ~~SSE Same-Origin (Route-Handler + nginx-Profil)~~
- ~~Prod-Secrets erzwingen (JWT/Bootstrap)~~
- ~~Audit + Rate-Limit für destruktive Compose-Aktionen~~
- ~~Backup ohne Klartext-Webhook~~
- ~~Settings Dirty-State~~
- ~~Live-Feedback Updates/Backups~~
- ~~Compose-Validierung (400 + Hinweise)~~
- ~~Self-Update (DOCKORA_SELF_IMAGE, Pull + Restart-Hinweis)~~
- ~~Self-Update mit automatischem Compose-Recreate~~
- ~~Plugin-Filesystem-Loader~~
- ~~E2E-Smoke erweitert~~
- ~~Image-Prune nach erfolgreichem Update~~
- ~~Monitoring-Alert-Dedup (Fingerprint + Cooldown)~~
- ~~Terminal Idle-Timeout + Message-Rate-Limit + WS-Protocol JWT~~
- ~~Scheduler nextRunAt + lastError + Labels~~
- ~~Backup-Restore Preview (Dry-Run + apply*-Flags)~~
- ~~User Edit (DisplayName / Passwort)~~
- CSRF-Token bei Cookie-Sessions (aktuell Bearer JWT)
- Plugin-Worker-Isolation (derzeit Pfad-Allowlist + Register-Timeout)
- ~~HTTPS-Profil (Caddy / Let’s Encrypt + interne CA)~~
- ~~Volume-Liste, Größe, unused prune, Browse~~
- ~~Compose-Projekt anlegen (eigene Seite)~~

