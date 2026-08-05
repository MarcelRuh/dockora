# Contributing to Dockora

Thanks for contributing! This document keeps the bar low but consistent.

## Development setup

**Requirements:** Node.js ≥ 22, pnpm ≥ 9, Docker (optional but recommended)

```bash
git clone https://github.com/<org>/dockora.git
cd dockora
cp .env.example .env
cp apps/api/.env.example apps/api/.env
# Edit secrets before production use

pnpm install
pnpm --filter @dockora/shared build
mkdir -p data/backups
cd apps/api && pnpm exec prisma migrate deploy && cd ../..
pnpm dev
```

- Web: http://localhost:3000  
- API: http://localhost:3001/api/v1/health  
- OpenAPI: http://localhost:3001/api/docs  

## Workflow

1. Open an issue first for larger changes.
2. Branch from `main`: `feat/…`, `fix/…`, `docs/…`.
3. Keep PRs focused (one concern per PR).
4. Ensure before opening a PR:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Optional smoke (API must be running):

```bash
pnpm smoke
```

## Code style

- TypeScript, existing patterns in `apps/api` / `apps/web`
- Prefer small, readable changes over clever abstractions
- UI copy: German + English in `apps/web/src/i18n/messages.ts`
- No secrets in commits; use `.env.example` for new variables

## Commit messages

Short imperative summary, optional body:

```
feat(compose): validate config with env hints

fix(auth): reject weak JWT secrets in production
```

## Security

See [SECURITY.md](./SECURITY.md). Never disclose vulnerabilities in public issues.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
