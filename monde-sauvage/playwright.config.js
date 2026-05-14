import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';

function portFromBaseURL(base) {
  try {
    const u = new URL(base);
    if (u.port) return u.port;
  } catch {
    /* ignore */
  }
  return '5173';
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer:
    process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
      ? undefined
      : {
          command: `npm run dev -- --host 127.0.0.1 --port ${portFromBaseURL(baseURL)}`,
          url: new URL('/map', baseURL).href,
          reuseExistingServer: true,
          timeout: 120_000,
        },
});
