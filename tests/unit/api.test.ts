/**
 * Gateway transport, public errors and monetary-input regressions.
 * @packageDocumentation
 */

import { afterEach, expect, it, vi } from 'vitest';
import { paymentStatus, request, submitSignature } from '../../src/api';

const payment = {
  id: 'fixture',
  network: 'solana-devnet',
  usdCents: 1000,
  lamports: '100000000',
  displaySol: '0.100000000',
  recipient: 'So11111111111111111111111111111111111111112',
  memo: 'crypto_gateway:fixture',
  expiresAt: Date.now() + 900000,
  status: 'pending',
  signature: null,
  attempts: [],
};

it.each([
  {},
  [],
  'private malformed payload',
  { ...payment, id: 'other-payment' },
  { ...payment, network: 'solana-mainnet' },
  { ...payment, usdCents: 0 },
  { ...payment, lamports: 'not-an-integer' },
  { ...payment, displaySol: '0.2' },
  { ...payment, expiresAt: 'tomorrow' },
  { ...payment, attempts: null },
  { ...payment, attempts: [null] },
  { ...payment, attempts: [{ signature: 'secret', state: 'pending' }] },
  { ...payment, signature: {} },
])(
  'rejects malformed successful responses for status and signature submission',
  async (data) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data }))),
        ),
    );
    await expect(paymentStatus('fixture', 'token')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    await expect(
      submitSignature('fixture', 'token', '1'.repeat(64)),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  },
);

it('accepts an exact server quote and safe recorded attempts without converting lamports to Number', async () => {
  const data = {
    ...payment,
    lamports: '9007199254740993',
    displaySol: '9007199.254740993',
    attempts: [{ signature: '1'.repeat(64), state: 'pending', reason: null }],
  };
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ data }))),
      ),
  );
  expect(await paymentStatus('fixture', 'token')).toEqual(data);
  expect(await submitSignature('fixture', 'token', '1'.repeat(64))).toEqual(
    data,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  [
    '22222222-2222-4222-8222-222222222222',
    ' Request ID: 22222222-2222-4222-8222-222222222222.',
  ],
  ['secret-or-malformed-reference', ''],
  ['22222222-2222-4222-8222-222222222222\n', ''],
  [null, ''],
])(
  'shows only a validated support reference: %s',
  async (requestId, suffix) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'Unable to complete request.',
              requestId,
            },
          }),
          { status: 500 },
        ),
      ),
    );
    await expect(request('http://localhost/fixture')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: `Unable to complete request.${suffix}`,
    });
  },
);

it('combines caller cancellation with the request deadline for stalled polling', async () => {
  const caller = new AbortController();
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  let activeSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          activeSignal = init.signal!;
          activeSignal.addEventListener(
            'abort',
            () => {
              const reason: unknown = activeSignal!.reason;
              reject(
                reason instanceof Error ? reason : new Error('Request aborted'),
              );
            },
            { once: true },
          );
        }),
    ),
  );
  const pending = request('http://localhost/fixture', {
    signal: caller.signal,
  });
  const assertion = expect(pending).rejects.toThrow('deadline');
  expect(activeSignal).not.toBe(caller.signal);
  deadline.abort(new Error('deadline'));
  await assertion;
  expect(caller.signal.aborted).toBe(false);
  expect(activeSignal?.aborted).toBe(true);
});
