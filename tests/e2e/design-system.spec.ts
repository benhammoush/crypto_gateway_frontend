/**
 * Rendered checkout tokens and notice presentation at narrow and wide widths.
 * @packageDocumentation
 */

import { expect, test } from '@playwright/test';

for (const width of [390, 1440]) {
  test(`preserves checkout surfaces and notices at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/demo/status', (route) =>
      route.fulfill({ json: { data: { enabled: false } } }),
    );
    await page.goto('/');
    const notice = page.getByRole('status');
    await expect(notice).toHaveText('Demo payments are disabled.');
    await expect(page.locator('html')).toHaveCSS(
      'background-color',
      'rgb(16, 21, 16)',
    );
    await expect(page.locator('.card')).toHaveCSS(
      'background-color',
      'rgb(23, 30, 22)',
    );
    await expect(page.locator('.card')).toHaveCSS('border-radius', '12px');
    await expect(notice).toHaveCSS('color', 'rgb(230, 214, 162)');
    await expect(notice).toHaveCSS('padding', '12px');
    await expect(notice).toHaveCSS('border-radius', '6px');
    await page.keyboard.press('Tab');
    // Select the target explicitly: native link tabbing varies by platform.
    await page.locator('.brand').focus();
    await expect(page.locator('.brand')).toBeFocused();
    await expect(page.locator('.brand')).toHaveCSS('outline-style', 'solid');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
