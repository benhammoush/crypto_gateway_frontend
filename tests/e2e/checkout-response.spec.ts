/** Malformed gateway responses must leave recovery controls and submission guards intact.
 * @packageDocumentation
 */
import { expect, test } from '@playwright/test';

test('malformed successful status never crashes the checkout', async ({
  page,
}) => {
  const id = '33333333-3333-4333-8333-333333333333';
  await page.route('**/v1/checkout/**', (route) =>
    route.fulfill({
      headers: {
        'access-control-allow-origin': test.info().project.use.baseURL!,
        'access-control-allow-headers': 'authorization',
      },
      json: { data: {} },
    }),
  );
  await page.goto(`/checkout/${id}#${'a'.repeat(64)}`);
  await expect(page.getByRole('alert')).toContainText(
    'Your payment has not been marked failed.',
  );
  await expect(
    page.getByRole('button', { name: 'Refresh status' }),
  ).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Pay with SOL' })).toHaveCount(
    0,
  );
});
