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
