// @vitest-environment jsdom
/** Reference polling, staleness and lifecycle cancellation regressions.
 * @packageDocumentation
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LivePrice } from '../../src/LivePrice';
import { referencePrice } from '../../src/api';

vi.mock('../../src/api', () => ({ referencePrice: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/** Flush one mocked network response and React's effects. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

it('refreshes reference text every 30 seconds with two-decimal display', async () => {
  vi.mocked(referencePrice).mockImplementation(() =>
    Promise.resolve({
      usdPrice:
        vi.mocked(referencePrice).mock.calls.length === 1
          ? '150.123456789'
          : '160',
      blockId: 123,
      fetchedAt: Date.now(),
    }),
  );
  render(<LivePrice />);
  await flush();
  expect(
    screen.getByText('SOL/USD reference · 1 SOL ≈ $150.12 USD'),
  ).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(
    screen.getByText('SOL/USD reference · 1 SOL ≈ $160.00 USD'),
  ).toBeTruthy();
  expect(referencePrice).toHaveBeenCalledTimes(2);
});

it('removes a rate on failure without exposing provider diagnostics', async () => {
  vi.mocked(referencePrice)
    .mockResolvedValueOnce({
      usdPrice: '150',
      blockId: 123,
      fetchedAt: Date.now(),
    })
    .mockRejectedValue(new Error('private provider details'));
  render(<LivePrice />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByText('SOL/USD reference unavailable.')).toBeTruthy();
  expect(document.body.textContent).not.toContain('$150');
  expect(document.body.textContent).not.toContain('private provider details');
});

it('hides stale data even if the next request remains pending', async () => {
  vi.mocked(referencePrice)
    .mockResolvedValueOnce({
      usdPrice: '150',
      blockId: 123,
      fetchedAt: Date.now(),
    })
    .mockImplementation(() => new Promise(() => {}));
  render(<LivePrice />);
  await flush();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByText('SOL/USD reference unavailable.')).toBeTruthy();
  expect(referencePrice).toHaveBeenCalledTimes(2);
});

it('pauses hidden work, refreshes on return and aborts on unmount', async () => {
  vi.mocked(referencePrice).mockResolvedValue({
    usdPrice: '150',
    blockId: 123,
    fetchedAt: Date.now(),
  });
  const view = render(<LivePrice />);
  await flush();
  const signal = vi.mocked(referencePrice).mock.calls[0][0];
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90_000);
  });
  expect(referencePrice).toHaveBeenCalledOnce();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await flush();
  expect(referencePrice).toHaveBeenCalledTimes(2);
  const active = vi.mocked(referencePrice).mock.calls[1][0];
  view.unmount();
  expect(active.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(90_000);
  });
  expect(referencePrice).toHaveBeenCalledTimes(2);
});
