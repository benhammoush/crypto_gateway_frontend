/** Display-only USD rate formatting; never used for payment arithmetic.
 * @packageDocumentation
 */
const usdRate = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Round a validated USD-per-SOL rate for display without changing the stored quote.
 * @param value - Exact positive decimal rate supplied by the gateway.
 * @returns A two-decimal USD rate; payable SOL amounts remain unrounded.
 */
export function formatUsdRate(value: string): string {
  return usdRate.format(Number(value));
}
