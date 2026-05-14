import { test, expect } from '@playwright/test';

const modal = (page) => page.locator('.login-modal-container');
const submitLogin = (page) => modal(page).locator('.login-submit-btn').first();

test.describe('Login modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/map');
    await page.getByRole('button', { name: /se connecter/i }).first().click();
    await expect(modal(page).locator('#email')).toBeVisible();
  });

  test('shows email and password fields', async ({ page }) => {
    await expect(modal(page).locator('#password')).toBeVisible();
    await expect(submitLogin(page)).toBeVisible();
  });

  test('empty credentials surface an error without React crashing', async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await submitLogin(page).click();
    await expect(modal(page).locator('.login-error')).toBeVisible({
      timeout: 25_000,
    });
    expect(pageErrors, pageErrors.map((e) => String(e)).join('\n')).toHaveLength(
      0
    );
  });

  test('invalid email and short password show an error', async ({ page }) => {
    await modal(page).locator('#email').fill('not-an-email');
    await modal(page).locator('#password').fill('x');
    await submitLogin(page).click();
    await expect(modal(page).locator('.login-error')).toBeVisible({
      timeout: 25_000,
    });
  });
});

const edgeCases = [
  { name: 'whitespace fields', email: '   ', password: '   ' },
  { name: 'long password', email: 'a@b.co', password: 'A'.repeat(2000) },
  { name: 'unicode password', email: 'a@b.co', password: '短碼' },
  { name: 'newline in password', email: 'a@b.co', password: 'a\nb' },
];

for (const { name, email, password } of edgeCases) {
  test(`weird input: ${name} — no page error and controlled failure`, async ({
    page,
  }) => {
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await page.goto('/map');
    await page.getByRole('button', { name: /se connecter/i }).first().click();
    await modal(page).locator('#email').fill(email);
    await modal(page).locator('#password').fill(password);
    await submitLogin(page).click();

    await expect(modal(page).locator('.login-error')).toBeVisible({
      timeout: 25_000,
    });
    expect(pageErrors, pageErrors.map((e) => String(e)).join('\n')).toHaveLength(
      0
    );
  });
}

test.describe('Authenticated smoke', () => {
  test('sign-in succeeds when AUDIT credentials are set', async ({ page }) => {
    const email = process.env.AUDIT_AUTH_EMAIL;
    const password = process.env.AUDIT_AUTH_PASSWORD;
    test.skip(
      !email || !password,
      'Set AUDIT_AUTH_EMAIL and AUDIT_AUTH_PASSWORD to run this test'
    );

    await page.goto('/map');
    await page.getByRole('button', { name: /se connecter/i }).first().click();
    await modal(page).locator('#email').fill(email);
    await modal(page).locator('#password').fill(password);
    await submitLogin(page).click();

    await expect(
      page.getByRole('button', { name: /parametres|settings/i }).first()
    ).toBeVisible({ timeout: 30_000 });
  });
});
