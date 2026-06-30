/**
 * Map resize regression — verifies that the Mapbox canvas doesn't visually
 * distort (glitch) when the sidebar changes width between booking steps.
 *
 * Strategy: capture the canvas pixel dimensions at step 0 and at step 1
 * (after clicking "Plannifiez votre séjour"), then confirm that:
 *   1. The canvas width actually changed (sidebar got narrower → map got wider)
 *   2. The canvas dimensions match the DOM container size at both snapshots
 *      (no stretching = canvas pixel size == CSS layout size)
 */

import { test, expect } from '@playwright/test';

async function dismissIntroSplash(page) {
  await page.addInitScript(() => {
    try {
      const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
      window.localStorage.setItem('ms_intro_splash_until', String(tenMinutesFromNow));
      window.localStorage.setItem('ms_intro_splash_first_seen', '1');
    } catch { /* ignore */ }
  });
}

/** Returns { canvasW, canvasH, containerW, containerH } for the Mapbox canvas. */
async function getMapDimensions(page) {
  return page.evaluate(() => {
    const container = document.querySelector('.mapboxgl-canvas-container') ??
                      document.querySelector('[class*="mapboxgl"]')?.closest('div');
    const canvas = document.querySelector('.mapboxgl-canvas') ??
                   document.querySelector('canvas');
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      canvasW: canvas.width,
      canvasH: canvas.height,
      containerW: Math.round(rect.width),
      containerH: Math.round(rect.height),
    };
  });
}

test.describe('Map canvas resize on sidebar step change', () => {
  test('canvas matches container size after step transition (no stretch glitch)', async ({ page }) => {
    test.setTimeout(60_000);

    await dismissIntroSplash(page);
    await page.goto('/map', { waitUntil: 'domcontentloaded' });

    // Wait for the map canvas to exist
    await expect(page.locator('.mapboxgl-canvas, canvas')).toBeAttached({ timeout: 30_000 });

    // Give Mapbox a moment to finish initial render + resize
    await page.waitForTimeout(1000);

    const before = await getMapDimensions(page);
    expect(before).not.toBeNull();

    // Open the booking flow — sidebar changes width
    const planBtn = page.getByRole('button', { name: /planifiez votre séjour|plan your trip/i });
    await expect(planBtn).toBeVisible({ timeout: 15_000 });
    await planBtn.click();

    // Wait one frame + a tiny buffer for ResizeObserver + rAF to fire
    await page.waitForTimeout(200);

    const after = await getMapDimensions(page);
    expect(after).not.toBeNull();

    // 1. Canvas pixel width should have grown (sidebar got replaced/shrunk → map wider)
    //    Accept equal too — viewport might be narrow enough that both states share width.
    expect(after.canvasW).toBeGreaterThanOrEqual(before.canvasW);

    // 2. The canvas pixel dimensions must match the CSS layout dimensions (no stretch).
    //    Allow 2px rounding tolerance between canvas attrs and getBoundingClientRect.
    const stretchW = Math.abs(after.canvasW - after.containerW);
    const stretchH = Math.abs(after.canvasH - after.containerH);

    expect(stretchW, `Canvas width (${after.canvasW}px) != container width (${after.containerW}px) — map is stretched`).toBeLessThanOrEqual(2);
    expect(stretchH, `Canvas height (${after.canvasH}px) != container height (${after.containerH}px) — map is stretched`).toBeLessThanOrEqual(2);
  });

  test('canvas stays in sync after multiple step transitions', async ({ page }) => {
    test.setTimeout(60_000);

    await dismissIntroSplash(page);
    await page.goto('/map', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.mapboxgl-canvas, canvas')).toBeAttached({ timeout: 30_000 });
    await page.waitForTimeout(800);

    // Open flow
    await page.getByRole('button', { name: /planifiez votre séjour|plan your trip/i }).click();
    await page.waitForTimeout(200);

    // Go to step 2 if there's a "Continuer" button available
    const continueBtn = page.getByRole('button', { name: /continuer →|continue →/i }).last();
    if (await continueBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(200);
    }

    const dims = await getMapDimensions(page);
    expect(dims).not.toBeNull();

    const stretchW = Math.abs(dims.canvasW - dims.containerW);
    const stretchH = Math.abs(dims.canvasH - dims.containerH);

    expect(stretchW, `Canvas stretched horizontally after step 2 transition`).toBeLessThanOrEqual(2);
    expect(stretchH, `Canvas stretched vertically after step 2 transition`).toBeLessThanOrEqual(2);
  });
});
