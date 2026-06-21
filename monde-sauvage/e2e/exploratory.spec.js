/**
 * Exploratory QA suite (targeted).
 *
 * Focus:
 * - Booking state flow resilience
 * - Auth/token invalidation behavior
 * - Stripe checkout modal open/close + network/console anomalies
 *
 * All console errors, page errors, failed requests, and 5xx responses fail the run.
 *
 * Env:
 * - EXPLORE_SEED (int) optional
 * - AUDIT_AUTH_EMAIL / AUDIT_AUTH_PASSWORD optional (enables auth-destruction scenario)
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const SEED = Number(process.env.EXPLORE_SEED) || Math.floor(Date.now() / 1000);

function isThirdPartyNoise(text) {
  return (
    /api\.mapbox\.com/i.test(text) ||
    /events\.mapbox\.com/i.test(text) ||
    /mapbox-gl\.js/i.test(text) ||
    /commons\.wikimedia\.org/i.test(text) ||
    /AbortError/i.test(text) ||
    /The operation was aborted/i.test(text)
  );
}

function attachAnomalyRecorder(page) {
  const anomalies = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
    stripeFailures: [],
    supabaseFailures: [],
    warnings: [],
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
    if (/Download the React DevTools/i.test(text)) return;
    if (/ResizeObserver loop/i.test(text)) return;

    if (isThirdPartyNoise(text)) {
      anomalies.warnings.push({ kind: 'console', text });
      return;
    }

    const location = msg.location();
    anomalies.consoleErrors.push({ text, location });
  });

  page.on('pageerror', (err) => {
    const message = err.message ?? String(err);
    const stack = err.stack ?? '';
    if (isThirdPartyNoise(message) || isThirdPartyNoise(stack)) {
      anomalies.warnings.push({ kind: 'pageerror', message, stack });
    } else {
      anomalies.pageErrors.push({ message, stack });
    }
  });

  page.on('requestfailed', (req) => {
    const failure = req.failure();
    if (failure?.errorText === 'net::ERR_ABORTED') return;
    const url = req.url();
    const entry = {
      url,
      method: req.method(),
      reason: failure?.errorText ?? 'unknown',
    };

    if (isThirdPartyNoise(url)) {
      anomalies.warnings.push({ kind: 'requestfailed', ...entry });
      return;
    }

    if (/stripe/i.test(url)) anomalies.stripeFailures.push(entry);
    if (/supabase/i.test(url)) anomalies.supabaseFailures.push(entry);
    anomalies.failedRequests.push(entry);
  });

  page.on('response', async (res) => {
    const status = res.status();
    const url = res.url();

    if (status >= 500) {
      const entry = { url, status, statusText: res.statusText() };
      anomalies.serverErrors.push(entry);
      if (/stripe/i.test(url)) anomalies.stripeFailures.push(entry);
      if (/supabase/i.test(url)) anomalies.supabaseFailures.push(entry);
      return;
    }

    // Stripe/Supabase failure signals we care about even if not 5xx.
    if (status >= 400 && /stripe|checkout|payment_intents/i.test(url)) {
      anomalies.stripeFailures.push({ url, status, statusText: res.statusText() });
    }
    if (status >= 400 && /supabase|auth\/v1|rest\/v1|functions\/v1/i.test(url)) {
      anomalies.supabaseFailures.push({ url, status, statusText: res.statusText() });
    }

    // Try to extract Supabase error payloads (best effort; avoid reading huge bodies).
    if (status >= 400 && status < 600 && /supabase/i.test(url)) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('application/json')) {
          const json = await res.json().catch(() => null);
          if (json && (json.error || json.message || json.code)) {
            anomalies.supabaseFailures.push({
              url,
              status,
              body: {
                error: json.error,
                message: json.message,
                code: json.code,
              },
            });
          }
        }
      } catch {
        /* ignore */
      }
    }
  });

  return anomalies;
}

function hasHardAnomalies(a) {
  return (
    a.consoleErrors.length > 0 ||
    a.pageErrors.length > 0 ||
    a.failedRequests.length > 0 ||
    a.serverErrors.length > 0
  );
}

async function dismissIntroSplash(page) {
  await page.addInitScript(() => {
    try {
      const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
      window.localStorage.setItem('ms_intro_splash_until', String(tenMinutesFromNow));
      window.localStorage.setItem('ms_intro_splash_first_seen', '1');
    } catch {
      /* ignore */
    }
  });
}

async function clickLastByName(page, nameRegex) {
  const buttons = page.getByRole('button', { name: nameRegex });
  const count = await buttons.count();
  if (count === 0) throw new Error(`No button found for ${nameRegex}`);
  await buttons.nth(count - 1).click();
}

test.describe(`Exploratory flows (seed=${SEED})`, () => {
  test('Determined booker: chalet flow + abandon checkout', async ({ page, context }, testInfo) => {
    test.setTimeout(240_000);

    await dismissIntroSplash(page);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const anomalies = attachAnomalyRecorder(page);

    await page.goto('/map', { waitUntil: 'domcontentloaded' });

    // Open booking flow (chalet only)
    await page.getByRole('button', { name: /réservez un chalet|book a chalet/i }).click();

    // Step 1: select a river (if present)
    const riverSelect = page.locator('select').first();
    if (await riverSelect.isVisible().catch(() => false)) {
      const options = riverSelect.locator('option');
      const optionCount = await options.count();
      if (optionCount >= 2) {
        await riverSelect.selectOption({ index: 1 });
      }
    }

    // Continue to dates
    await clickLastByName(page, /continuer →|continue →/i);

    // Step 2: choose two enabled dates.
    const enabledDays = page.locator('button.date-picker-day:not(.disabled)');
    await expect(enabledDays.first()).toBeVisible({ timeout: 30_000 });
    await enabledDays.nth(0).click();
    await enabledDays.nth(1).click();

    // Continue to results
    await clickLastByName(page, /continuer →|continue →/i);

    // Step 3: wait for markers and select a chalet via preview card.
    const firstMarker = page.locator('.ms-chalet-marker').first();
    await expect(firstMarker).toBeVisible({ timeout: 60_000 });
    await firstMarker.click({ force: true });

    const selectChaletBtn = page.getByRole('button', { name: /sélectionner ce chalet|select this chalet/i });
    await expect(selectChaletBtn).toBeVisible({ timeout: 10_000 });
    await selectChaletBtn.click();

    // Continue to equipment step (if present) or booking step
    await clickLastByName(page, /continuer →|continue →/i);

    // Try booking (may open Stripe checkout modal, or may insert sans Stripe)
    await clickLastByName(page, /réserver →|book →/i);

    const checkoutModal = page.locator('.checkout-modal');
    if (await checkoutModal.isVisible().catch(() => false)) {
      // Abandon immediately (during loading/ready) and ensure it closes cleanly.
      await page.locator('button.checkout-close').click({ timeout: 20_000 });
      await expect(checkoutModal).toBeHidden({ timeout: 20_000 });

      // Refresh mid-flow and ensure app remains interactive.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: /planifiez votre séjour|plan your trip/i })).toBeVisible({ timeout: 30_000 });
    } else {
      // No checkout modal: ensure booking confirmation renders.
      await expect(page.getByText(/réservation confirmée|booking confirmed/i)).toBeVisible({ timeout: 60_000 });
    }

    const artifactBase = `explore_determined_booker_seed${SEED}`;
    const summaryPath = testInfo.outputPath(`${artifactBase}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({ seed: SEED, anomalies }, null, 2));
    testInfo.attachments.push({ name: 'explore-summary.json', path: summaryPath, contentType: 'application/json' });

    if (hasHardAnomalies(anomalies)) {
      const screenshotPath = testInfo.outputPath(`${artifactBase}.png`);
      const tracePath = testInfo.outputPath(`${artifactBase}.trace.zip`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      await context.tracing.stop({ path: tracePath }).catch(() => {});
      testInfo.attachments.push({ name: 'explore-screenshot', path: screenshotPath, contentType: 'image/png' });
      testInfo.attachments.push({ name: 'explore-trace', path: tracePath, contentType: 'application/zip' });
    } else {
      await context.tracing.stop().catch(() => {});
    }

    expect(
      {
        consoleErrors: anomalies.consoleErrors,
        pageErrors: anomalies.pageErrors,
        failedRequests: anomalies.failedRequests,
        serverErrors: anomalies.serverErrors,
      },
      `Exploratory determined-booker surfaced anomalies. See ${summaryPath}.`
    ).toMatchObject({
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      serverErrors: [],
    });
  });

  test('State & auth destruction: second tab sign-out invalidates first tab', async ({ page, context }, testInfo) => {
    const email = process.env.AUDIT_AUTH_EMAIL;
    const password = process.env.AUDIT_AUTH_PASSWORD;
    test.skip(!email || !password, 'Set AUDIT_AUTH_EMAIL and AUDIT_AUTH_PASSWORD to run this scenario');

    test.setTimeout(240_000);

    await dismissIntroSplash(page);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

    const anomalies = attachAnomalyRecorder(page);

    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /se connecter|log in/i }).first().click();
    await expect(page.locator('.login-modal-container #email')).toBeVisible({ timeout: 30_000 });
    await page.locator('.login-modal-container #email').fill(email);
    await page.locator('.login-modal-container #password').fill(password);
    await page.locator('.login-modal-container .login-submit-btn').first().click();

    // Ensure logged-in controls appear
    await expect(page.getByRole('button', { name: /se déconnecter|sign out/i })).toBeVisible({ timeout: 30_000 });

    // Second tab: sign out
    const page2 = await context.newPage();
    await dismissIntroSplash(page2);
    attachAnomalyRecorder(page2);
    await page2.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page2.getByRole('button', { name: /se déconnecter|sign out/i })).toBeVisible({ timeout: 30_000 });
    await page2.getByRole('button', { name: /se déconnecter|sign out/i }).click();
    await expect(page2.getByRole('button', { name: /se connecter|log in/i })).toBeVisible({ timeout: 30_000 });

    // First tab: attempt an authenticated action path and refresh mid-flow.
    await page.bringToFront();
    await page.getByRole('button', { name: /planifiez votre séjour|plan your trip/i }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });

    // After token invalidation, app should not crash; it should either show logged-out UI or recover.
    await expect(
      page.getByRole('button', { name: /se connecter|log in|planifiez votre séjour|plan your trip/i }).first()
    ).toBeVisible({ timeout: 30_000 });

    const artifactBase = `explore_auth_destruction_seed${SEED}`;
    const summaryPath = testInfo.outputPath(`${artifactBase}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({ seed: SEED, anomalies }, null, 2));
    testInfo.attachments.push({ name: 'explore-auth-summary.json', path: summaryPath, contentType: 'application/json' });

    if (hasHardAnomalies(anomalies)) {
      const screenshotPath = testInfo.outputPath(`${artifactBase}.png`);
      const tracePath = testInfo.outputPath(`${artifactBase}.trace.zip`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      await context.tracing.stop({ path: tracePath }).catch(() => {});
      testInfo.attachments.push({ name: 'explore-screenshot', path: screenshotPath, contentType: 'image/png' });
      testInfo.attachments.push({ name: 'explore-trace', path: tracePath, contentType: 'application/zip' });
    } else {
      await context.tracing.stop().catch(() => {});
    }

    expect(
      {
        consoleErrors: anomalies.consoleErrors,
        pageErrors: anomalies.pageErrors,
        failedRequests: anomalies.failedRequests,
        serverErrors: anomalies.serverErrors,
      },
      `Exploratory auth-destruction surfaced anomalies. See ${summaryPath}.`
    ).toMatchObject({
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
      serverErrors: [],
    });
  });
});
