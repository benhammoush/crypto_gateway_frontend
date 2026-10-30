/** Display rounding is independent from the exact payment quote.
 * @packageDocumentation
 */
import { expect, it } from 'vitest';
import { formatUsdRate } from '../../src/format-price';

it.each([
  ['150.123456789', '150.12'],
  ['150.129999999', '150.13'],
  ['100.00000001', '100.00'],
  ['150.005', '150.01'],
  ['1.5025e2', '150.25'],
  ['1234.5', '1,234.50'],
])('formats %s as %s for display only', (exact, display) => {
  expect(formatUsdRate(exact)).toBe(display);
});
