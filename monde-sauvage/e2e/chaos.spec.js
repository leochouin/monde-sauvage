/**
 * Chaos / "Monkey" testing suite.
 *
 * Goals:
 *   - Hammer the app with random navigation, random clicks, edge-case form
 *     input, and rage-clicks to surface race conditions and unhandled errors.
 *   - Capture *every* console error, page error, failed request, and 5xx
 *     response — any of those fails the test and saves a screenshot + trace
 *     under ./test-results so the developer can pull on the thread.
 *   - Stay deterministic when CHAOS_SEED is set so failures can be reproduced.
 *
 * Knobs (all optional, all env):
 *   - CHAOS_SEED        Integer seed for the PRNG. Defaults to Date.now().
 *   - CHAOS_ITERATIONS  Per-scenario interaction count. Defaults to 40.
 *   - CHAOS_REGISTER    "1" to exercise the sign-up path with faker emails.
 *   - CHAOS_ROUTES      Comma-separated list of routes to monkey. Defaults
 *                       to "/map,/social,/chalet/non-existent-id-<rand>".
 */

import { test, expect } from '@playwright/test';
import { faker } from '@faker-js/faker';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ──────────────────────────────────────────────────────────────────────────────
// Deterministic RNG (mulberry32) so CHAOS_SEED reproduces a run.
//
// Important: Playwright workers re-evaluate this spec file independently, so
// any non-deterministic value used in a `test(...)` *title* MUST be consistent
// across processes — otherwise workers crash with "Test not found in worker
// process". We fall back to the file's mtime so every worker computes the same
// seed without needing the user to set CHAOS_SEED.
// ──────────────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const fileMtimeSeed = (() => {
  try { return Math.floor(fs.statSync(__filename).mtimeMs); } catch { return 1; }
})();
const SEED = Number(process.env.CHAOS_SEED) || fileMtimeSeed;
const ITERATIONS = Number(process.env.CHAOS_ITERATIONS) || 40;
const REGISTER_MODE = process.env.CHAOS_REGISTER === '1';
const DEFAULT_ROUTES = ['/map', '/social', `/chalet/chaos-${SEED}`];
const ROUTES = (process.env.CHAOS_ROUTES?.split(',').map((s) => s.trim()).filter(Boolean)) || DEFAULT_ROUTES;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

faker.seed(SEED);

// ──────────────────────────────────────────────────────────────────────────────
// Edge-case payload library used to feed every <input>/<textarea> we find.
// ──────────────────────────────────────────────────────────────────────────────
const EDGE_CASE_STRINGS = [
  '',
  ' ',
  '   leading and trailing   ',
  'a'.repeat(2000),
  'A'.repeat(50_000),
  '🌲🦊🐟🚣‍♀️🔥💥🌊',
  '\u0000\u0001\u0002 null bytes ahoy',
  '\n\n\n\n\nnewlines\n\n',
  '\t\t\ttabs\t\t',
  '<script>alert(1)</script>',
  '"; DROP TABLE users; --',
  "' OR '1'='1",
  '${7*7}{{7*7}}',
  '../../../../etc/passwd',
  'https://evil.example/?q=' + 'A'.repeat(500),
  '日本語テスト 中文测试 한국어 테스트',
  '🙂'.repeat(200),
  '-9999999999',
  '0.0000000000001',
  'NaN',
  'Infinity',
  'null',
  'undefined',
  '{"json":true,"nested":{"deep":[1,2,3]}}',
];

const EDGE_CASE_NUMBERS = ['-1', '-9999', '0', '0.0001', '1e308', '1e-308', '999999999999999999'];

const randomEdgeString = () => pick(EDGE_CASE_STRINGS);
const randomEdgeNumber = () => pick(EDGE_CASE_NUMBERS);

const fakeEmail = () => {
  const handle = faker.internet.username().replace(/[^a-z0-9.]/gi, '').toLowerCase() || 'chaos';
  // Disposable-style providers; we only need to *send* — verification is OK to skip.
  const domain = pick(['mailinator.com', 'tempmail.dev', 'sharklasers.com', 'guerrillamail.com', 'mail7.io']);
  return `${handle}.${faker.string.alphanumeric(6).toLowerCase()}@${domain}`;
};

// ──────────────────────────────────────────────────────────────────────────────
// Anomaly recorder — wired into every scenario.
// ──────────────────────────────────────────────────────────────────────────────
// Patterns that are emitted by third-party code or are abort-induced during
// rapid chaos navigation. They get recorded as `warnings` (not failures) so the
// test report still surfaces them but a single one does not fail the run.
const THIRD_PARTY_NOISE = [
  /api\.mapbox\.com/i,
  /events\.mapbox\.com/i,
  /mapbox-gl\.js/i,
  /maps\.googleapis\.com/i,
  /commons\.wikimedia\.org/i,
  /AbortError/i,
  /The operation was aborted/i,
  /Failed to fetch.*mapbox/i,
];

function isThirdPartyNoise(text, locationUrl) {
  return THIRD_PARTY_NOISE.some((re) => re.test(text) || (locationUrl && re.test(locationUrl)));
}

function attachAnomalyRecorder(page) {
  const anomalies = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
    warnings: [],
  };

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const location = msg.location();
    // Chromium auto-logs "Failed to load resource: ... status of NNN" for every
    // non-2xx response. We already capture HTTP status via the `response`
    // listener (where we keep only 5xx). 4xx is normal in chaos testing
    // (deliberately malformed inputs) so we drop the duplicate console noise.
    if (/Failed to load resource/i.test(text)) return;
    // React DevTools / suggested-fix lines are noise.
    if (/Download the React DevTools/i.test(text)) return;
    // ResizeObserver loop is a known benign browser warning.
    if (/ResizeObserver loop/i.test(text)) return;

    const entry = { text, location };
    if (isThirdPartyNoise(text, location?.url)) {
      anomalies.warnings.push({ kind: 'console', ...entry });
    } else {
      anomalies.consoleErrors.push(entry);
    }
  });

  page.on('pageerror', (err) => {
    const message = err.message ?? String(err);
    const stack = err.stack ?? '';
    if (isThirdPartyNoise(message, stack)) {
      anomalies.warnings.push({ kind: 'pageerror', message, stack });
    } else {
      anomalies.pageErrors.push({ message, stack });
    }
  });

  page.on('requestfailed', (req) => {
    const failure = req.failure();
    // Ignore aborts we caused ourselves (e.g. navigating away mid-fetch).
    if (failure?.errorText === 'net::ERR_ABORTED') return;
    const entry = {
      url: req.url(),
      method: req.method(),
      reason: failure?.errorText ?? 'unknown',
    };
    if (isThirdPartyNoise(entry.url, entry.url)) {
      anomalies.warnings.push({ kind: 'requestfailed', ...entry });
    } else {
      anomalies.failedRequests.push(entry);
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 500) {
      anomalies.serverErrors.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
      });
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

// ──────────────────────────────────────────────────────────────────────────────
// Monkey actions.
// ──────────────────────────────────────────────────────────────────────────────
async function dismissIntroSplash(page) {
  // The app stores a long cooldown in localStorage to skip the intro splash.
  await page.addInitScript(() => {
    try {
      const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
      window.localStorage.setItem('ms_intro_splash_until', String(tenMinutesFromNow));
      window.localStorage.setItem('ms_intro_splash_first_seen', '1');
    } catch {
      /* private mode — nothing to do */
    }
  });
}

async function listClickableHandles(page) {
  // Buttons, links, role=button, summary tags. Filter to visible+enabled+inside viewport.
  return page
    .locator(
      [
        'button:not([disabled])',
        'a[href]',
        '[role="button"]:not([aria-disabled="true"])',
        'summary',
        '[data-testid]',
      ].join(', ')
    )
    .all();
}

async function listFillableHandles(page) {
  return page
    .locator(
      [
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="submit"]):not([type="button"]):not([disabled]):not([readonly])',
        'textarea:not([disabled]):not([readonly])',
      ].join(', ')
    )
    .all();
}

async function tryAction(label, fn) {
  try {
    await fn();
    return { ok: true, label };
  } catch (err) {
    // Per-action failures are *expected* in chaos testing (elements detach mid-click etc.)
    // We only escalate genuine app errors, which the anomaly recorder catches separately.
    return { ok: false, label, error: String(err?.message ?? err) };
  }
}

async function monkeyClick(page) {
  const handles = await listClickableHandles(page);
  if (handles.length === 0) return tryAction('click:no-targets', async () => {});
  const target = pick(handles);
  return tryAction('click', async () => {
    await target.scrollIntoViewIfNeeded({ timeout: 1500 });
    await target.click({ timeout: 1500, force: true, trial: false });
  });
}

async function monkeyFill(page) {
  const handles = await listFillableHandles(page);
  if (handles.length === 0) return tryAction('fill:no-targets', async () => {});
  const target = pick(handles);
  const type = (await target.getAttribute('type'))?.toLowerCase();
  const isEmail = type === 'email';
  const isNumber = type === 'number';
  const isDate = type === 'date';

  let value;
  if (isEmail) value = rand() < 0.5 ? fakeEmail() : randomEdgeString();
  else if (isNumber) value = randomEdgeNumber();
  else if (isDate) value = pick(['1900-01-01', '9999-12-31', '2026-02-30', '2026-13-45', '']);
  else value = randomEdgeString();

  return tryAction(`fill[type=${type ?? '?'}]`, async () => {
    await target.fill(value, { timeout: 1500, force: true });
  });
}

async function rageClick(page) {
  const handles = await listClickableHandles(page);
  if (handles.length === 0) return tryAction('rage:no-targets', async () => {});
  const target = pick(handles);
  return tryAction('rage-click', async () => {
    await target.scrollIntoViewIfNeeded({ timeout: 1500 });
    const burst = between(5, 15);
    await Promise.allSettled(
      Array.from({ length: burst }, () => target.click({ timeout: 800, force: true, noWaitAfter: true }))
    );
  });
}

async function randomKeyboardChaos(page) {
  return tryAction('keyboard', async () => {
    const keys = ['Escape', 'Tab', 'Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Backspace'];
    await page.keyboard.press(pick(keys), { delay: 5 });
  });
}

async function randomScroll(page) {
  return tryAction('scroll', async () => {
    const dy = between(-2000, 2000);
    await page.mouse.wheel(0, dy);
  });
}

const ACTIONS = [
  { name: 'click', fn: monkeyClick, weight: 6 },
  { name: 'fill', fn: monkeyFill, weight: 4 },
  { name: 'rage-click', fn: rageClick, weight: 1 },
  { name: 'keyboard', fn: randomKeyboardChaos, weight: 2 },
  { name: 'scroll', fn: randomScroll, weight: 2 },
];

function pickWeightedAction() {
  const total = ACTIONS.reduce((s, a) => s + a.weight, 0);
  let r = rand() * total;
  for (const a of ACTIONS) {
    r -= a.weight;
    if (r <= 0) return a;
  }
  return ACTIONS[0];
}

// ──────────────────────────────────────────────────────────────────────────────
// Test runner.
//
test.describe(`Chaos monkey (seed=${SEED}, iterations=${ITERATIONS})`, () => {
  // Each route gets its own fresh page/context — keep them independent so one
  // failure doesn't mask bugs on the other routes.
  for (const route of ROUTES) {
    test(`monkey-tests route ${route}`, async ({ page, context }, testInfo) => {
      test.setTimeout(120_000 + ITERATIONS * 1500);

      await dismissIntroSplash(page);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });

      const anomalies = attachAnomalyRecorder(page);
      const actionLog = [];

      // Step 1: visit the route.
      const navResult = await tryAction(`goto ${route}`, async () => {
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      });
      actionLog.push(navResult);

      // Step 2: settle a beat so first paint can throw whatever it's going to throw.
      await page.waitForTimeout(500);

      // Step 3: monkey loop.
      for (let i = 0; i < ITERATIONS; i += 1) {
        const action = pickWeightedAction();
        const result = await action.fn(page);
        actionLog.push({ iteration: i, ...result });

        // Tiny jitter so async handlers can catch up but we still hit race conditions.
        await page.waitForTimeout(between(20, 120));

        // Periodically poke an extra random nav so we cross route boundaries.
        if (i > 0 && i % 17 === 0 && rand() < 0.4) {
          await tryAction('mid-run nav', async () => {
            await page.goto(pick(ROUTES), { waitUntil: 'domcontentloaded', timeout: 15_000 });
          });
          await page.waitForTimeout(300);
        }
      }

      // Step 4: write artifacts and assert no anomalies.
      const safeRoute = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
      const artifactBase = `chaos_${safeRoute}_seed${SEED}`;
      const summaryPath = testInfo.outputPath(`${artifactBase}.json`);
      const summary = {
        route,
        seed: SEED,
        iterations: ITERATIONS,
        anomalies,
        actionCounts: actionLog.reduce((acc, a) => {
          const key = a.label?.split(':')[0] ?? a.label ?? 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        actionLog: actionLog.slice(-50), // keep file small — last 50 actions
      };
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      testInfo.attachments.push({ name: `chaos-summary-${safeRoute}.json`, path: summaryPath, contentType: 'application/json' });

      if (hasHardAnomalies(anomalies)) {
        const screenshotPath = testInfo.outputPath(`${artifactBase}.png`);
        const tracePath = testInfo.outputPath(`${artifactBase}.trace.zip`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        await context.tracing.stop({ path: tracePath }).catch(() => {});
        testInfo.attachments.push({ name: 'chaos-screenshot', path: screenshotPath, contentType: 'image/png' });
        testInfo.attachments.push({ name: 'chaos-trace', path: tracePath, contentType: 'application/zip' });
      } else {
        // Discard trace; no hard anomalies to investigate.
        await context.tracing.stop().catch(() => {});
      }

      // `warnings` are surfaced in the JSON summary but do not fail the run —
      // they're useful signals (e.g. mapbox tile aborts under rapid scroll)
      // without being actionable bugs.
      expect(
        {
          consoleErrors: anomalies.consoleErrors,
          pageErrors: anomalies.pageErrors,
          failedRequests: anomalies.failedRequests,
          serverErrors: anomalies.serverErrors,
        },
        `Chaos run on ${route} surfaced hard anomalies (seed ${SEED}). See ${summaryPath}.`
      ).toMatchObject({
        consoleErrors: [],
        pageErrors: [],
        failedRequests: [],
        serverErrors: [],
      });
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Optional: pound the sign-up endpoint with disposable faker emails to look
  // for 500s in the auth path. Enable with CHAOS_REGISTER=1.
  // ────────────────────────────────────────────────────────────────────────────
  test('signup chaos (disposable faker emails)', async ({ page, context }, testInfo) => {
    test.skip(!REGISTER_MODE, 'Set CHAOS_REGISTER=1 to exercise the sign-up path.');
    test.setTimeout(180_000);

    await dismissIntroSplash(page);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    const anomalies = attachAnomalyRecorder(page);

    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /se connecter/i }).first().click();

    const modal = page.locator('.login-modal-container');
    await expect(modal.locator('#email')).toBeVisible({ timeout: 15_000 });

    // Flip the modal into register mode.
    const toggle = modal.getByRole('button', { name: /s'?inscrire|sign\s*up/i }).first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }

    const attempts = Math.max(5, Math.floor(ITERATIONS / 4));
    for (let i = 0; i < attempts; i += 1) {
      const email = fakeEmail();
      const password = faker.internet.password({ length: between(4, 64) });
      await modal.locator('#email').fill(email);
      await modal.locator('#password').fill(password);

      const confirm = modal.locator('#confirmPassword');
      if (await confirm.isVisible().catch(() => false)) {
        // 30% of the time, intentionally mis-confirm to exercise the validation branch.
        await confirm.fill(rand() < 0.3 ? `${password}xx` : password);
      }

      await modal.getByRole('button', { name: /(cr.er un compte|sign\s*up|se connecter|log\s*in)/i })
        .first()
        .click()
        .catch(() => {});

      // Don't wait for network idle — we want to overlap requests for race conditions.
      await page.waitForTimeout(between(150, 600));
    }

    const summaryPath = testInfo.outputPath(`chaos_signup_seed${SEED}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify({ seed: SEED, attempts, anomalies }, null, 2));
    testInfo.attachments.push({ name: 'chaos-signup-summary.json', path: summaryPath, contentType: 'application/json' });

    if (hasHardAnomalies(anomalies)) {
      const screenshotPath = testInfo.outputPath(`chaos_signup_seed${SEED}.png`);
      const tracePath = testInfo.outputPath(`chaos_signup_seed${SEED}.trace.zip`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      await context.tracing.stop({ path: tracePath }).catch(() => {});
      testInfo.attachments.push({ name: 'chaos-screenshot', path: screenshotPath, contentType: 'image/png' });
      testInfo.attachments.push({ name: 'chaos-trace', path: tracePath, contentType: 'application/zip' });
    } else {
      await context.tracing.stop().catch(() => {});
    }

    expect(
      { pageErrors: anomalies.pageErrors, serverErrors: anomalies.serverErrors },
      `Sign-up chaos surfaced hard anomalies (seed ${SEED}). See ${summaryPath}.`
    ).toMatchObject({
      pageErrors: [],
      serverErrors: [],
    });
  });
});
