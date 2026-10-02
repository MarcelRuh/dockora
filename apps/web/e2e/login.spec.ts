import { expect, test } from '@playwright/test';

test('login screen is reachable and skip-link works', async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('link', { name: /Zum Inhalt springen|Skip to content/i });
  await expect(skip).toBeAttached();

  const email = page.getByLabel(/E-Mail|Email/i);
  const password = page.getByLabel(/Passwort|Password/i);
  await expect(email.or(page.locator('input[type="email"]')).first()).toBeVisible({
    timeout: 15_000,
  });
  await expect(password.or(page.locator('input[type="password"]')).first()).toBeVisible();
});

test('pages are not frameable from another site by default', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.headers()['x-frame-options']?.toLowerCase()).toBe('sameorigin');
});

test('signed-in forms expose labels and the second login step does too', async ({ page }) => {
  const email = process.env.SMOKE_EMAIL ?? 'admin@dockora.local';
  const password = process.env.SMOKE_PASSWORD ?? 'dockora-admin-change-me';

  await page.goto('/');
  await page.getByLabel(/E-Mail|Email/i).fill(email);
  await page.getByLabel(/Passwort|Password/i).fill(password);
  await page.getByRole('button', { name: /Anmelden|Sign in/i }).click();
  await expect(page.getByRole('button', { name: /Anmelden|Sign in/i })).toHaveCount(0);

  const totp = page.getByLabel(/Authenticator-Code|Authenticator code/i);
  if (await totp.isVisible().catch(() => false)) {
    await expect(totp).toBeVisible();
    await expect(page.getByText(/6-stelliger Code|6-digit code/i)).toBeVisible();
    return;
  }

  await page.goto('/settings');
  await page.getByRole('button', { name: /Sicherheit|Security/i }).click();
  await expect(page.getByLabel(/^E-Mail$|^Email$/)).toBeVisible();
  await expect(page.getByLabel(/Passwort \(min|Password \(min/i)).toBeVisible();
  await expect(page.getByLabel(/Anzeigename|Display name/i).first()).toBeVisible();
  await expect(page.getByLabel(/^Rolle$|^Role$/)).toBeVisible();
});

test('backup, updates and the dock stay idle until an explicit confirm', async ({ page }) => {
  const email = process.env.SMOKE_EMAIL ?? 'admin@dockora.local';
  const password = process.env.SMOKE_PASSWORD ?? 'dockora-admin-change-me';

  await page.goto('/');
  await page.getByLabel(/E-Mail|Email/i).fill(email);
  await page.getByLabel(/Passwort|Password/i).fill(password);
  await page.getByRole('button', { name: /Anmelden|Sign in/i }).click();
  await expect(page.getByRole('button', { name: /Anmelden|Sign in/i })).toHaveCount(0);

  const totp = page.getByLabel(/Authenticator-Code|Authenticator code/i);
  if (await totp.isVisible().catch(() => false)) return;

  await page.goto('/backups');
  await expect(page.getByRole('heading', { name: /Backups/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Backup erstellen|Create backup/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/updates');
  await expect(page.getByRole('heading', { name: /Updates/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/self-update');
  await expect(page.getByText(/Prüft GitHub|Checks GitHub/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Jetzt aktualisieren|Update now/i })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/');
  const dock = page.locator('[data-dock-key="containers"]');
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('aria-keyshortcuts', /Alt\+ArrowLeft/);
});
