import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const WEAK_JWT_SECRETS = new Set([
  'change-me-in-production-use-long-random-string',
  'dockora-dev-secret-change-me',
  'secret',
  'changeme',
  'jwt-secret',
]);

const WEAK_BOOTSTRAP_PASSWORDS = new Set([
  'dockora-admin-change-me',
  'admin',
  'password',
  'changeme',
]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().min(1),
  DOCKER_SOCKET: z.string().default('/var/run/docker.sock'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  COMPOSE_SEARCH_PATHS: z.string().default('/opt,/srv,/home'),
  /** Kommagetrennte Pfade, die bei der Compose-Discovery übersprungen werden */
  COMPOSE_EXCLUDE_PATHS: z.string().default(''),
  /** Kommagetrennte Image-Tag-Prefixe die ausgeblendet werden (zusätzlich zu dockora-*) */
  IMAGE_EXCLUDE_PREFIXES: z.string().default('dockora'),
  AUTO_UPDATE_ENABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  BACKUP_DIR: z.string().optional(),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().optional(),
  /** Image-Ref für Dockora Self-Update (z. B. ghcr.io/org/dockora-api:latest) */
  DOCKORA_SELF_IMAGE: z.string().optional(),
  /** Host-Pfad der Compose-Installation (für In-App-Update) */
  DOCKORA_INSTALL_DIR: z.string().optional(),
  /** Mount-Pfad im API-Container (default: /dockora-install) */
  DOCKORA_INSTALL_MOUNT: z.string().optional(),
  /** GitHub repo owner/name für Compose-Self-Update */
  DOCKORA_REPO: z.string().optional(),
  /** Branch für Compose-Self-Update */
  DOCKORA_UPDATE_BRANCH: z.string().optional(),
  /** Optional: lokale Git-Revision (sonst .dockora-revision) */
  DOCKORA_GIT_SHA: z.string().optional(),
  /** Verzeichnis für Drop-in-Plugins (index.js pro Unterordner) */
  PLUGIN_DIR: z.string().optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  databaseUrl: string;
  dockerSocket: string;
  corsOrigin: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  rateLimitMax: number;
  rateLimitTimeWindowMs: number;
  composeSearchPaths: string[];
  composeExcludePaths: string[];
  imageExcludePrefixes: string[];
  autoUpdateEnabled: boolean;
  backupDir: string;
  bootstrapAdminEmail: string;
  bootstrapAdminPassword: string | null;
  selfImage: string | null;
  installDirHost: string | null;
  installDirMount: string | null;
  repo: string;
  updateBranch: string;
  gitSha: string | null;
  pluginDir: string;
};

function splitPaths(value: string): string[] {
  return value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function looksLikeDockoraRoot(dir: string): boolean {
  try {
    return (
      existsSync(path.join(dir, 'apps', 'api', 'package.json')) &&
      existsSync(path.join(dir, 'apps', 'web', 'package.json')) &&
      existsSync(path.join(dir, 'pnpm-workspace.yaml'))
    );
  } catch {
    return false;
  }
}

/** Ermittelt den Dockora-Installationsroot, damit er aus der Discovery ausgeblendet wird. */
function detectDockoraRoot(): string | null {
  const candidates = [
    process.env.DOCKORA_ROOT,
    path.resolve(process.cwd(), '../..'),
    path.resolve(process.cwd()),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (looksLikeDockoraRoot(candidate)) return path.resolve(candidate);
  }
  return null;
}

export function isWeakJwtSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (WEAK_JWT_SECRETS.has(normalized)) return true;
  if (/change-me|changeme|replace-me|docker-compose/i.test(secret)) return true;
  return false;
}

export function isWeakBootstrapPassword(password: string): boolean {
  const normalized = password.trim().toLowerCase();
  if (WEAK_BOOTSTRAP_PASSWORDS.has(normalized)) return true;
  if (password.length < 12) return true;
  return false;
}

function assertProductionSecrets(
  nodeEnv: string,
  jwtSecret: string,
  bootstrapPassword: string | undefined,
): void {
  if (nodeEnv !== 'production') return;

  if (jwtSecret.length < 32) {
    throw new Error(
      'Production requires JWT_SECRET with at least 32 characters (use a long random string)',
    );
  }
  if (isWeakJwtSecret(jwtSecret)) {
    throw new Error(
      'Production rejects weak JWT_SECRET defaults – set a unique random secret',
    );
  }

  // Bootstrap-Passwort muss gesetzt und stark sein, falls der erste Admin angelegt wird
  if (bootstrapPassword == null || bootstrapPassword === '') {
    throw new Error(
      'Production requires BOOTSTRAP_ADMIN_PASSWORD (min 12 chars, not a known default)',
    );
  }
  if (isWeakBootstrapPassword(bootstrapPassword)) {
    throw new Error(
      'Production rejects weak BOOTSTRAP_ADMIN_PASSWORD – use at least 12 characters and avoid defaults',
    );
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  const e = parsed.data;
  assertProductionSecrets(e.NODE_ENV, e.JWT_SECRET, e.BOOTSTRAP_ADMIN_PASSWORD);

  const exclude = splitPaths(e.COMPOSE_EXCLUDE_PATHS).map((p) => path.resolve(p));
  const detected = detectDockoraRoot();
  if (
    detected &&
    !exclude.some((p) => path.resolve(p) === detected)
  ) {
    exclude.push(detected);
  }

  const dockoraRoot = detected ?? path.resolve(process.cwd(), '../..');
  const backupDir = e.BACKUP_DIR
    ? path.resolve(e.BACKUP_DIR)
    : path.join(dockoraRoot, 'data', 'backups');

  const pluginDir = e.PLUGIN_DIR
    ? path.resolve(e.PLUGIN_DIR)
    : path.join(dockoraRoot, 'plugins');

  return {
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    dockerSocket: e.DOCKER_SOCKET,
    corsOrigin: e.CORS_ORIGIN,
    jwtSecret: e.JWT_SECRET,
    jwtExpiresIn: e.JWT_EXPIRES_IN,
    rateLimitMax: e.RATE_LIMIT_MAX,
    rateLimitTimeWindowMs: e.RATE_LIMIT_TIME_WINDOW_MS,
    composeSearchPaths: splitPaths(e.COMPOSE_SEARCH_PATHS),
    composeExcludePaths: exclude,
    imageExcludePrefixes: splitPaths(e.IMAGE_EXCLUDE_PREFIXES),
    autoUpdateEnabled: e.AUTO_UPDATE_ENABLED,
    backupDir,
    bootstrapAdminEmail: e.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@dockora.local',
    bootstrapAdminPassword: e.BOOTSTRAP_ADMIN_PASSWORD ?? null,
    selfImage: e.DOCKORA_SELF_IMAGE?.trim() || null,
    // Dev: Auto-Detect Repo-Root. Prod/Compose: DOCKORA_INSTALL_DIR (+ optional Mount).
    installDirHost: e.DOCKORA_INSTALL_DIR?.trim() || detected || null,
    installDirMount:
      e.DOCKORA_INSTALL_MOUNT?.trim() ||
      e.DOCKORA_INSTALL_DIR?.trim() ||
      detected ||
      null,
    repo: e.DOCKORA_REPO?.trim() || 'MarcelRuh/dockora',
    updateBranch: e.DOCKORA_UPDATE_BRANCH?.trim() || 'main',
    gitSha: e.DOCKORA_GIT_SHA?.trim() || null,
    pluginDir,
  };
}
