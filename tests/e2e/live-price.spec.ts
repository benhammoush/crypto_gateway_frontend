/** Live reference and locked-rate separation using local fixtures, never real payments.
 * @packageDocumentation
 */
import { expect, test } from '@playwright/test';

for (const width of [320, 1280]) {
  test(`reference refresh stops at creation and the locked rate survives reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.install();
    const id = '55555555-5555-4555-8555-555555555555';
    const token = 'a'.repeat(64);
    const headers = {
      'access-control-allow-origin': test.info().project.use.baseURL!,
      'access-control-allow-headers': 'authorization',
    };
    let reads = 0;
    await page.route('**/v1/price', (route) => {
      reads++;
      return route.fulfill({
        headers,
        json: {
          data: {
            usdPrice: reads === 1 ? '150.123456789' : '160',
            blockId: 123,
            fetchedAt: Date.now(),
          },
        },
      });
    });
    await page.route('**/api/demo/status', (route) =>
      route.fulfill({ json: { data: { enabled: true } } }),
    );
    await page.route('**/api/demo/payments', (route) => {
      expect(route.request().postDataJSON()).toEqual({ usdCents: 1000 });
      return route.fulfill({
        json: {
          data: {
            checkoutUrl: `${test.info().project.use.baseURL}/checkout/${id}#${token}`,
          },
        },
      });
    });
    await page.route('**/v1/checkout/**', (route) =>
      route.fulfill({
        headers,
        json: {
          data: {
            id,
            usdCents: 1000,
            lamports: '100000000',
            displaySol: '0.100000000',
            network: 'solana-devnet',
            recipient: 'So11111111111111111111111111111111111111112',
            memo: `crypto_gateway:${id}`,
            expiresAt: Date.now() + 900_000,
            status: 'pending',
            signature: null,
            attempts: [],
            quote: { usdPrice: '100.00000001', blockId: 456 },
          },
        },
      }),
    );
    await page.goto('/');
    const reference = page.getByRole('region', {
      name: 'SOL/USD reference price',
    });
    await expect(reference).toContainText('$150.12 USD');
    if (test.info().project.name === 'chromium') {
      await page.screenshot({
        path: test.info().outputPath(`reference-${width}.png`),
        fullPage: true,
      });
    }
    await page.clock.runFor(30_000);
    await expect(reference).toContainText('$160.00 USD');
    expect(reads).toBe(2);
    await page
      .getByRole('button', { name: 'Create payment link', exact: true })
      .click();
    await expect(
      page.getByText('Locked rate · 1 SOL ≈ $100.00 USD'),
    ).toBeVisible();
    await expect(reference).toHaveCount(0);
    if (test.info().project.name === 'chromium') {
      await page.screenshot({
        path: test.info().outputPath(`locked-${width}.png`),
        fullPage: true,
      });
    }
    await page.clock.runFor(90_000);
    expect(reads).toBe(2);
    await expect(
      page.getByText('0.100000000 SOL', { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Locked rate · 1 SOL ≈ $100.00 USD'),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create payment link', exact: true }),
    ).toHaveCount(0);
    expect(reads).toBe(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test('reference failure is honest and does not prevent server-side quote creation', async ({
  page,
}) => {
  await page.route('**/api/demo/status', (route) =>
    route.fulfill({ json: { data: { enabled: true } } }),
  );
  await page.route('**/v1/price', (route) =>
    route.fulfill({
      status: 503,
      headers: {
        'access-control-allow-origin': test.info().project.use.baseURL!,
      },
      json: {
        error: {
          code: 'PRICE_UNAVAILABLE',
          message: 'private upstream details',
        },
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByText('SOL/USD reference unavailable.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create payment link', exact: true }),
  ).toBeEnabled();
  await expect(page.locator('body')).not.toContainText(
    'private upstream details',
  );
});
