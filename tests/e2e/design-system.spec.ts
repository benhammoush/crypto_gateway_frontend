/** Standard Ant Design layout, locked roles and accessible transaction receipts.
 * @packageDocumentation
 */
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/v1/price', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': test.info().project.use.baseURL!,
      },
      json: {
        data: {
          usdPrice: '150.123456789',
          blockId: 123,
          fetchedAt: Date.now(),
        },
      },
    }),
  );
});

for (const width of [320, 390, 1440, 1920]) {
  test(`two-role demo stays readable and keyboard accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/demo/status', (route) =>
      route.fulfill({ json: { data: { enabled: true } } }),
    );
    await page.goto('/');
    await expect(page).toHaveTitle('Pay with Solana');
    const business = page.getByRole('region', {
      name: 'Business',
      exact: true,
    });
    const customer = page.getByRole('region', {
      name: 'Customer',
      exact: true,
    });
    const handoff = page.getByRole('region', { name: 'Checkout link handoff' });
    await expect(handoff).toHaveClass('handoff handoff-waiting');
    await expect(business.locator('.ant-card')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await expect(business.locator('.ant-card')).toHaveCSS(
      'border-radius',
      '10px',
    );
    const create = page.getByRole('button', {
      name: 'Create payment link',
      exact: true,
    });
    await expect(create).toBeEnabled();
    await expect(create).toHaveCSS('background-color', 'rgb(22, 119, 255)');
    await expect(
      business.getByText(
        'In a real store, it comes automatically from the customer’s cart.',
      ),
    ).toBeVisible();
    await expect(customer).toContainText('— SOL');
    await expect(customer.locator('[inert]')).toHaveCount(1);
    await expect(customer.getByRole('status')).toContainText(
      'Waiting for checkout creation',
    );
    await expect(customer.locator('.panel-status-card')).toHaveCSS(
      'border-radius',
      '8px',
    );
    await expect(business.locator('.ant-card-head')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    );
    await expect(
      page.getByRole('heading', { name: 'Pay with Solana' }),
    ).toBeVisible();
    await expect(
      page
        .getByRole('heading', { name: 'Pay with Solana' })
        .getByText('Solana', { exact: true }),
    ).toHaveCSS('color', 'rgb(114, 46, 209)');
    await expect(
      page
        .getByRole('list', { name: 'Payment progress' })
        .getByRole('listitem'),
    ).toHaveCount(3);
    await expect(
      page.getByRole('list', { name: 'Payment progress' }),
    ).not.toContainText('Transaction submitted');
    await expect(
      page.getByRole('list', { name: 'Payment progress' }),
    ).not.toContainText('Payment verified');
    const b = (await business.boundingBox())!;
    const c = (await customer.boundingBox())!;
    const h = (await handoff.boundingBox())!;
    const progress = (await page
      .getByRole('list', { name: 'Payment progress' })
      .boundingBox())!;
    if (width >= 768) {
      expect(
        (await page.locator('.checkout-layout').boundingBox())!.width,
      ).toBe(1280);
      expect(h.x).toBeGreaterThanOrEqual(b.x + b.width);
      expect(c.x).toBeGreaterThanOrEqual(h.x + h.width);
      expect(Math.abs(b.y + b.height / 2 - (c.y + c.height / 2))).toBeLessThan(
        3,
      );
      const stages = page
        .getByRole('list', { name: 'Payment progress' })
        .locator('.ant-steps-item');
      for (let index = 0; index < 3; index++) {
        const icon = (await stages
          .nth(index)
          .locator('.ant-steps-item-icon')
          .boundingBox())!;
        const content = (await stages
          .nth(index)
          .locator('.ant-steps-item-content')
          .boundingBox())!;
        expect(
          Math.abs(icon.x + icon.width / 2 - (content.x + content.width / 2)),
        ).toBeLessThan(2);
      }
    } else {
      expect(h.y).toBeGreaterThanOrEqual(b.y + b.height);
      expect(c.y).toBeGreaterThanOrEqual(h.y + h.height);
    }
    expect(progress.y).toBeGreaterThan(c.y + c.height);
    await page.getByLabel('Cart total (USD)').focus();
    await page.keyboard.press('Tab');
    await expect(create).toBeFocused();
    await expect(create).toHaveCSS('outline-style', 'solid');
    await expect(
      page.getByRole('link', { name: 'UI built with Ant Design' }),
    ).toHaveAttribute('href', 'https://ant.design');
    await page.getByRole('combobox', { name: 'Network' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.ant-select-item-option-disabled')).toHaveText(
      'Mainnet (unavailable)',
    );
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const width of [320, 1440]) {
  for (const status of [
    'pending',
    'verifying',
    'settled',
    'expired',
  ] as const) {
    test(`customer checkout ${status} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      const id = '44444444-4444-4444-8444-444444444444';
      const signature = '1'.repeat(64);
      const sent = status === 'verifying' || status === 'settled';
      await page.route('**/v1/checkout/**', async (route) => {
        expect(['GET', 'OPTIONS']).toContain(route.request().method());
        const headers = {
          'access-control-allow-origin': test.info().project.use.baseURL!,
          'access-control-allow-headers': 'authorization',
        };
        await route.fulfill(
          route.request().method() === 'OPTIONS'
            ? { headers, body: '' }
            : {
                headers,
                json: {
                  data: {
                    id,
                    usdCents: 1,
                    quote: { usdPrice: '99.732716', blockId: 123 },
                    lamports: '100268',
                    displaySol: '0.000100268',
                    network: 'solana-devnet',
                    memo: `crypto_gateway:${id}`,
                    recipient: 'So11111111111111111111111111111111111111112',
                    expiresAt:
                      Date.now() + (status === 'expired' ? -1000 : 900000),
                    status,
                    attempts: sent
                      ? [{ signature, state: 'pending', reason: null }]
                      : [],
                    signature: status === 'settled' ? signature : null,
                  },
                },
              },
        );
      });
      await page.goto(`/checkout/${id}#${'a'.repeat(64)}`);
      await expect(
        page.getByRole('combobox', { name: 'Network' }),
      ).toBeDisabled();
      await expect(
        page.getByRole('region', { name: 'Business', exact: true }),
      ).toHaveCount(0);
      const customer = page.getByRole('region', {
        name: 'Customer',
        exact: true,
      });
      await expect(
        customer.getByText('0.000100268 SOL', { exact: true }),
      ).toBeVisible();
      if (sent) {
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog).toContainText('0.000100268 SOL');
        await expect(
          dialog.getByRole('link', { name: /View transaction/ }),
        ).toHaveAttribute(
          'href',
          `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        );
        await expect(dialog.getByRole('status')).toHaveClass(
          status === 'settled' ? /ant-alert-success/ : /ant-alert-info/,
        );
        const box = (await dialog.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        const reopen = page.getByRole('button', {
          name: 'View payment status',
        });
        await expect(reopen).toBeFocused();
        await expect(customer.locator('.submitted-panel')).toHaveCSS(
          'opacity',
          '1',
        );
        await expect(customer.locator('.submitted-panel')).toHaveCSS(
          'filter',
          'grayscale(1)',
        );
        await expect(
          page.getByRole('button', { name: 'Pay with SOL' }),
        ).toHaveCount(0);
        await reopen.click();
        await expect(dialog).toBeVisible();
        await expect(dialog).toBeInViewport({ ratio: 1 });
        await expect(page.locator('body')).not.toContainText('a'.repeat(64));
      } else if (status === 'pending') {
        await expect(
          page.getByRole('button', { name: 'Connect wallet' }),
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Pay with SOL' }),
        ).toBeDisabled();
      } else {
        await expect(page.getByRole('alert')).toContainText(
          'Do not send a new transfer',
        );
        await expect(
          page.getByRole('button', { name: 'Pay with SOL' }),
        ).toHaveCount(0);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
