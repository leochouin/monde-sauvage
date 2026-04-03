#!/usr/bin/env node

const { chromium } = require('playwright');

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:5173';
const MAP_ROUTE = process.env.AUDIT_MAP_ROUTE || '/map';
const AUTH_EMAIL = process.env.AUDIT_AUTH_EMAIL || process.env.AUTH_EMAIL || '';
const AUTH_PASSWORD = process.env.AUDIT_AUTH_PASSWORD || process.env.AUTH_PASSWORD || '';
const STRICT_AUTH_AUDIT = process.env.STRICT_AUTH_AUDIT === '1';
const NAVIGATION_TIMEOUT_MS = Number(process.env.AUDIT_NAV_TIMEOUT_MS || 30000);

function makeUrl(pathname) {
  return new URL(pathname, BASE_URL).toString();
}

async function tryClick(page, locator, timeout = 4000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function runAudit() {
  const summary = {
    auditedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    skipped: false,
    passed: false,
    checks: {
      loginSuccess: false,
      accountModalOpened: false,
      accountMutationPathExercised: false,
      bookingFlowStep1Exercised: false,
      noPageErrors: true,
      noConsoleErrors: true,
      noFailedRequests: true,
    },
    warnings: [],
    errors: [],
    details: {
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
    },
  };

  if (!AUTH_EMAIL || !AUTH_PASSWORD) {
    summary.skipped = true;
    summary.warnings.push('Missing AUDIT_AUTH_EMAIL and AUDIT_AUTH_PASSWORD environment variables.');
    if (STRICT_AUTH_AUDIT) {
      summary.errors.push('STRICT_AUTH_AUDIT=1 requires credentials.');
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      process.exit(1);
    }
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  page.on('console', (message) => {
    if (message.type() === 'error') {
      summary.details.consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    summary.details.pageErrors.push(String(error));
  });

  page.on('requestfailed', (request) => {
    summary.details.failedRequests.push({
      url: request.url(),
      method: request.method(),
      reason: request.failure() ? request.failure().errorText : 'unknown',
    });
  });

  try {
    await page.goto(makeUrl(MAP_ROUTE), {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    const loginOpen = await tryClick(page, page.getByRole('button', { name: /se connecter/i }).first());
    if (!loginOpen) {
      summary.errors.push('Could not open login modal from map page.');
      throw new Error('login_modal_not_opened');
    }

    await page.locator('#email').fill(AUTH_EMAIL);
    await page.locator('#password').fill(AUTH_PASSWORD);

    const submitClicked = await tryClick(page, page.getByRole('button', { name: /log in/i }).first());
    if (!submitClicked) {
      summary.errors.push('Could not submit login form.');
      throw new Error('login_submit_failed');
    }

    await page.waitForLoadState('networkidle', { timeout: NAVIGATION_TIMEOUT_MS });

    await page.getByRole('button', { name: /parametres/i }).first().waitFor({ state: 'visible', timeout: 10000 });
    summary.checks.loginSuccess = true;

    const settingsOpened = await tryClick(page, page.getByRole('button', { name: /parametres/i }).first());
    if (settingsOpened) {
      await page.getByText(/Param.tres du compte/i).first().waitFor({ state: 'visible', timeout: 10000 });
      summary.checks.accountModalOpened = true;

      const guideTab = page.getByRole('button', { name: /guide/i }).first();
      const guideTabVisible = await guideTab.isVisible().catch(() => false);

      if (guideTabVisible) {
        await guideTab.click();
        const saveGuideButton = page.getByRole('button', { name: /Sauvegarder le profil/i }).first();
        const saveGuideVisible = await saveGuideButton.isVisible().catch(() => false);
        if (saveGuideVisible) {
          await saveGuideButton.click({ timeout: 5000 });
          await page.waitForTimeout(900);
          summary.checks.accountMutationPathExercised = true;
        } else {
          summary.warnings.push('Guide tab is available but save profile button was not found.');
        }
      } else {
        summary.warnings.push('Guide tab not available for this account; guide mutation path skipped.');
      }

      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    } else {
      summary.errors.push('Could not open account settings modal after login.');
    }

    const startTripButton = page.getByRole('button', { name: /Planifiez votre séjour/i }).first();
    const tripStarted = await tryClick(page, startTripButton, 7000);

    if (tripStarted) {
      const dateInputs = page.locator('input[type="date"]');
      await dateInputs.nth(0).fill('2026-06-10');
      await dateInputs.nth(1).fill('2026-06-12');

      const fishSelect = page.locator('select').first();
      await fishSelect.selectOption('saumon');

      const continueButton = page.getByRole('button', { name: /Continuer/i }).first();
      await continueButton.waitFor({ state: 'visible', timeout: 5000 });
      const isDisabled = await continueButton.isDisabled();
      if (!isDisabled) {
        summary.checks.bookingFlowStep1Exercised = true;
      } else {
        summary.warnings.push('Booking step 1 continue button stayed disabled after filling required fields.');
      }
    } else {
      summary.warnings.push('Could not open booking flow from map sidebar.');
    }

    summary.checks.noPageErrors = summary.details.pageErrors.length === 0;
    summary.checks.noConsoleErrors = summary.details.consoleErrors.length === 0;
    summary.checks.noFailedRequests = summary.details.failedRequests.length === 0;

    summary.passed = summary.checks.loginSuccess
      && summary.checks.accountModalOpened
      && summary.checks.bookingFlowStep1Exercised
      && summary.checks.noPageErrors
      && summary.checks.noConsoleErrors
      && summary.checks.noFailedRequests;
  } finally {
    await context.close();
    await browser.close();
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (!summary.passed) {
    process.exitCode = 1;
  }
}

runAudit().catch((error) => {
  process.stderr.write(`[audit:auth] fatal error: ${String(error)}\n`);
  process.exit(1);
});
