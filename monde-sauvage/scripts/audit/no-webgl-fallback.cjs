#!/usr/bin/env node

const { chromium, devices } = require('playwright');

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:5173';
const MAP_ROUTE = process.env.AUDIT_MAP_ROUTE || '/map';
const SOCIAL_ROUTE = process.env.AUDIT_SOCIAL_ROUTE || '/social';
const NAVIGATION_TIMEOUT_MS = Number(process.env.AUDIT_NAV_TIMEOUT_MS || 30000);

const scenarios = [
  {
    name: 'desktop',
    useDevice: null,
    viewport: { width: 1440, height: 900 },
  },
  {
    name: 'tablet',
    useDevice: devices['iPad Pro 11'],
    viewport: null,
  },
  {
    name: 'mobile',
    useDevice: devices['iPhone 13'],
    viewport: null,
  },
];

function makeUrl(pathname) {
  return new URL(pathname, BASE_URL).toString();
}

function injectNoWebgl() {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
    const normalized = String(type || '').toLowerCase();
    if (normalized.includes('webgl')) {
      return null;
    }
    return originalGetContext.call(this, type, ...args);
  };

  Object.defineProperty(window, 'WebGLRenderingContext', {
    configurable: true,
    writable: true,
    value: undefined,
  });

  Object.defineProperty(window, 'WebGL2RenderingContext', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

async function runScenario(browser, scenario) {
  const contextOptions = scenario.useDevice
    ? { ...scenario.useDevice }
    : { viewport: scenario.viewport };

  const context = await browser.newContext(contextOptions);
  await context.addInitScript(injectNoWebgl);

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  page.on('pageerror', (error) => {
    pageErrors.push(String(error));
  });

  page.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      reason: request.failure() ? request.failure().errorText : 'unknown',
    });
  });

  const mapUrl = makeUrl(MAP_ROUTE);
  const socialUrl = makeUrl(SOCIAL_ROUTE);

  let fallbackVisible = false;
  let retryVisible = false;
  let retryWorked = false;

  try {
    await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });

    const fallbackAlert = page.getByRole('alert').first();
    await fallbackAlert.waitFor({ state: 'visible', timeout: 7000 });
    fallbackVisible = await fallbackAlert.isVisible();

    const retryButton = page.getByRole('button', { name: /reessayer/i }).first();
    retryVisible = await retryButton.isVisible();

    await retryButton.click({ timeout: 3000 });
    await page.waitForTimeout(500);
    retryWorked = await page.getByRole('alert').first().isVisible();

    await page.goto(socialUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(300);
    await page.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: NAVIGATION_TIMEOUT_MS });
    await page.waitForTimeout(500);
  } catch (error) {
    pageErrors.push(`scenario_failure:${String(error)}`);
  }

  await context.close();

  const uncaughtLikeConsoleErrors = consoleErrors.filter((entry) => {
    const lower = entry.toLowerCase();
    return !lower.includes('warning') && !lower.includes('warn');
  });

  const passed = fallbackVisible
    && retryVisible
    && retryWorked
    && pageErrors.length === 0
    && uncaughtLikeConsoleErrors.length === 0;

  return {
    scenario: scenario.name,
    passed,
    checks: {
      fallbackVisible,
      retryVisible,
      retryWorked,
      noPageErrors: pageErrors.length === 0,
      noConsoleErrors: uncaughtLikeConsoleErrors.length === 0,
    },
    pageErrors,
    consoleErrors: uncaughtLikeConsoleErrors,
    failedRequests,
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const scenario of scenarios) {
      const result = await runScenario(browser, scenario);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const summary = {
    auditedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    mapRoute: MAP_ROUTE,
    socialRoute: SOCIAL_ROUTE,
    passed: results.every((result) => result.passed),
    results,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (!summary.passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`[audit:no-webgl] fatal error: ${String(error)}\n`);
  process.exit(1);
});
