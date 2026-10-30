/** Visible-cart reference pricing; never supplies amounts to payment creation.
 * @packageDocumentation
 */
import { useEffect, useState } from 'react';
import { referencePrice } from './api';
import { formatUsdRate } from './format-price';
import { Flex, Typography } from './design-system';
import type { ReferencePrice } from './types';

/** Refresh only while visible and discard unavailable or stale reference prices.
 * @returns An indicative rate and retrieval time, or an honest unavailable state.
 */
export function LivePrice() {
  const [price, setPrice] = useState<ReferencePrice>();
  const [checking, setChecking] = useState(true);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    /** Read one reference, then schedule the next without overlapping requests. */
    async function refresh() {
      if (disposed || document.visibilityState === 'hidden') return;
      controller = new AbortController();
      const current = controller;
      try {
        const value = await referencePrice(current.signal);
        if (!current.signal.aborted) {
          setPrice(value);
          setNow(Date.now());
        }
      } catch {
        if (!current.signal.aborted) setPrice(undefined);
      } finally {
        if (!current.signal.aborted) {
          setChecking(false);
          timer = setTimeout(() => void refresh(), 30_000);
        }
      }
    }
    /** Stop hidden-tab work and refresh when returning instead of showing old data. */
    function visibilityChanged() {
      clearTimeout(timer);
      controller?.abort();
      setPrice(undefined);
      setChecking(true);
      if (document.visibilityState !== 'hidden') void refresh();
    }
    void refresh();
    const clock = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  const fresh = price && now - price.fetchedAt < 60_000;
  return (
    <Flex vertical gap={4} role="region" aria-label="SOL/USD reference price">
      <Typography.Text className="exchange-rate" aria-live="polite">
        {fresh
          ? `SOL/USD reference · 1 SOL ≈ $${formatUsdRate(price.usdPrice)} USD`
          : checking
            ? 'Checking SOL/USD reference…'
            : 'SOL/USD reference unavailable.'}
      </Typography.Text>
      {fresh && (
        <Typography.Text type="secondary">
          Last checked{' '}
          <time dateTime={new Date(price.fetchedAt).toISOString()}>
            {new Date(price.fetchedAt).toLocaleTimeString()}
          </time>
          . Refreshes every 30 seconds.
        </Typography.Text>
      )}
      <Typography.Text type="secondary">
        Indicative only. Your rate locks when the payment link is created.
      </Typography.Text>
    </Flex>
  );
}
