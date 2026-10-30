/**
 * Browser checkout flow with controlled wallet and gateway responses.
 * @packageDocumentation
 */

import { expect, test } from '@playwright/test';
import { loadEnv } from 'vite';
import {
  SystemInstruction,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

const diagnosticsEnabled =
  loadEnv('development', process.cwd(), 'VITE_').VITE_APP_ENV === 'dev';

test('checkout displays a safe support reference without suggesting another payment', async ({
  page,
}) => {
  const id = '33333333-3333-4333-8333-333333333333';
  const requestId = '22222222-2222-4222-8222-222222222222';
  await page.route('**/v1/checkout/**', async (route) => {
    const headers = {
      'access-control-allow-origin': test.info().project.use.baseURL!,
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, OPTIONS',
    };
    await route.fulfill(
      route.request().method() === 'OPTIONS'
        ? { headers, body: '' }
        : {
            headers,
            status: 500,
            json: {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'The request could not be completed.',
                requestId,
              },
            },
          },
    );
  });
  await page.goto(`/checkout/${id}#${'a'.repeat(64)}`);
  await expect(page.getByRole('alert')).toContainText(
    `Request ID: ${requestId}.`,
  );
  await expect(page.getByRole('alert')).toContainText(
    'Your payment has not been marked failed.',
  );
  await expect(page.getByRole('button', { name: 'Pay with SOL' })).toHaveCount(
    0,
  );
});

test('wallet failure hints stay dev-only and cannot trigger a second submission', async ({
  page,
}) => {
  const id = '33333333-3333-4333-8333-333333333333';
  const secret = 'fixture-secret-must-not-render';
  const headers = {
    'access-control-allow-origin': test.info().project.use.baseURL!,
    'access-control-allow-headers':
      'authorization, content-type, solana-client',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };
  await page.addInitScript((secret) => {
    Object.assign(window, {
      fixtureSendCount: 0,
      phantom: {
        solana: {
          isPhantom: true,
          /** Return the connected public key from the controlled wallet.
           * @returns The controlled payer's public-key adapter.
           */
          connect: () =>
            Promise.resolve({
              publicKey: {
                /** Return the fixture public key in wallet encoding.
                 * @returns The base58 fixture payer.
                 */
                toBase58: () => '1'.repeat(32),
              },
            }),
          /** Count a controlled submission and reject with a wallet RPC failure.
           * @returns A rejected wallet request without broadcasting a transaction.
           */
          signAndSendTransaction: () => {
            const state = window as unknown as { fixtureSendCount: number };
            state.fixtureSendCount++;
            return Promise.reject(
              Object.assign(
                new Error(
                  `Blockhash not found; https://rpc.invalid/?api-key=${secret}`,
                ),
                {
                  code: -32603,
                },
              ),
            );
          },
        },
      },
    });
  }, secret);
  await page.route('**/v1/checkout/**', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ headers, body: '' });
    } else if (route.request().url().endsWith('/rpc')) {
      const body = route.request().postDataJSON() as {
        id: number;
        method: string;
      };
      await route.fulfill({
        headers,
        json: {
          jsonrpc: '2.0',
          id: body.id,
          result:
            body.method === 'getGenesisHash'
              ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
              : {
                  context: { slot: 1 },
                  value: {
                    blockhash: '1'.repeat(32),
                    lastValidBlockHeight: 100,
                  },
                },
        },
      });
    } else {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({
        headers,
        json: {
          data: {
            id,
            usdCents: 1,
            displaySol: '0.000095794',
            lamports: '95794',
            status: 'pending',
            recipient: 'So11111111111111111111111111111111111111112',
            quote: { usdPrice: '100', blockId: 123 },
            expiresAt: Date.now() + 900_000,
            memo: `crypto_gateway:${id}`,
            network: 'solana-devnet',
            attempts: [],
            signature: null,
          },
        },
      });
    }
  });
  await page.goto(`/checkout/${id}#${'a'.repeat(64)}`);
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: 'Pay with SOL' }).click();
  await expect(page.getByRole('status')).toContainText('WALLET_RPC_-32603');
  if (diagnosticsEnabled) {
    await expect(page.getByRole('status')).toContainText(
      'Dev wallet hint: BLOCKHASH_EXPIRED_OR_MISSING',
    );
    await expect(page.getByRole('status')).toContainText(
      'Time since blockhash fetched:',
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await expect(page.getByRole('status')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('dev-wallet-diagnostic.png'),
      fullPage: true,
    });
  } else {
    await expect(
      page.getByText('Dev wallet hint:', { exact: false }),
    ).toHaveCount(0);
  }
  await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('button', { name: 'Pay with SOL' })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { fixtureSendCount: number }).fixtureSendCount,
    ),
  ).toBe(1);
  const stored = await page.evaluate(
    (id) =>
      sessionStorage.getItem(`crypto_gateway:signature:${id}:walletFailure`),
    id,
  );
  expect(stored ?? '').not.toContain(secret);
  if (!diagnosticsEnabled) expect(stored).toBeNull();
});

for (const responseLoss of ['none', 'unrecorded', 'recorded'] as const) {
  const loseResponse = responseLoss !== 'none';
  test(`browser wallet flow verifies only after authoritative settlement${loseResponse ? ` after a lost ${responseLoss} submission response and reload` : ''}`, async ({
    page,
  }) => {
    const id = '22222222-2222-4222-8222-222222222222';
    let submitted = false;
    let settled = false;
    let recoverSubmission = !loseResponse;
    let walletSends = 0;
    const submissions: string[] = [];
    const rpcMethods: string[] = [];
    await page.exposeFunction('validateFixtureMessage', (wire: number[]) => {
      walletSends++;
      const bytes = new Uint8Array(wire);
      const decoded = VersionedTransaction.deserialize(bytes);
      expect(decoded.version).toBe('legacy');
      const transaction = Transaction.from(bytes);
      expect(transaction.instructions).toHaveLength(2);
      const transfer = SystemInstruction.decodeTransfer(
        transaction.instructions[0],
      );
      expect(transfer.lamports).toBe(100000000n);
      expect(transfer.fromPubkey.toBase58()).toBe('1'.repeat(32));
      expect(transfer.toPubkey.toBase58()).toBe(
        'So11111111111111111111111111111111111111112',
      );
      expect(transaction.feePayer?.toBase58()).toBe('1'.repeat(32));
      expect(decoded.message.header.numRequiredSignatures).toBe(1);
      const memo = transaction.instructions[1];
      expect(memo.programId.toBase58()).toBe(
        'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
      );
      expect(new TextDecoder().decode(memo.data)).toBe(`crypto_gateway:${id}`);
      expect(memo.keys[0].pubkey.toBase58()).toBe('1'.repeat(32));
      expect(memo.keys[0].isSigner).toBe(true);
    });
    await page.addInitScript(() => {
      Object.assign(window, {
        phantom: {
          solana: {
            isPhantom: true,
            /** Defer connection until the test explicitly approves the fixture wallet.
             * @returns The controlled connection after explicit fixture approval.
             */
            connect: () =>
              new Promise((resolve) =>
                Object.assign(window, {
                  /** Resolve the wallet connection after the test has arranged expiry state.
                   * @returns Completion after resolving the deferred connection.
                   */
                  approveFixtureWallet: () =>
                    resolve({
                      publicKey: {
                        /** Return the fixture public key in wallet encoding.
                         * @returns The base58 fixture payer.
                         */
                        toBase58: () => '11111111111111111111111111111111',
                      },
                    }),
                }),
              ),
            /** Inspect serialized wire bytes before returning the controlled submission result.
             * @param transaction - Wallet-bound transaction prepared by checkout.
             * @returns The fixture signature after message validation succeeds.
             */
            signAndSendTransaction: async (
              transaction: Pick<VersionedTransaction, 'serialize'>,
            ) => {
              const bytes = transaction.serialize();
              if (!(bytes instanceof Uint8Array))
                throw new Error('Wallet serialization must be synchronous.');
              await (
                window as unknown as {
                  /** Check the serialized wallet message in the Node-side fixture.
                   * @param wire - Serialized transaction byte values.
                   * @returns Completion after assertions pass.
                   */
                  validateFixtureMessage(wire: number[]): Promise<void>;
                }
              ).validateFixtureMessage(Array.from(bytes));
              return { signature: '1'.repeat(64) };
            },
          },
        },
      });
    });
    const headers = {
      'access-control-allow-origin': test.info().project.use.baseURL!,
      'access-control-allow-headers':
        'authorization, content-type, solana-client',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    };
    await page.route('**/v1/checkout/**/rpc', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers, body: '' });
        return;
      }
      const body = route.request().postDataJSON() as {
        method: string;
        params: unknown[];
        id: number;
      };
      const method = body.method;
      if (method === 'getLatestBlockhash')
        expect(body.params).toEqual([{ commitment: 'finalized' }]);
      expect(route.request().headers().authorization).toBe(
        `Bearer ${'a'.repeat(64)}`,
      );
      rpcMethods.push(method);
      await route.fulfill({
        headers,
        json: {
          jsonrpc: '2.0',
          id: body.id,
          result:
            method === 'getGenesisHash'
              ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
              : {
                  context: { slot: 123 },
                  value: {
                    blockhash: '11111111111111111111111111111111',
                    lastValidBlockHeight: 100,
                  },
                },
        },
      });
    });
    await page.route('**/v1/checkout/**', async (route) => {
      if (route.request().url().endsWith('/rpc')) return route.fallback();
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({ headers, body: '' });
        return;
      }
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as { signature: string };
        expect(body).toEqual({
          signature: '1'.repeat(64),
        });
        submissions.push(body.signature);
        if (!recoverSubmission) {
          if (responseLoss === 'recorded') submitted = true;
          return route.abort('timedout');
        }
        submitted = true;
      }
      await route.fulfill({
        headers,
        json: {
          data: {
            id,
            usdCents: 1000,
            displaySol: '0.100000000',
            lamports: '100000000',
            status: settled ? 'settled' : submitted ? 'verifying' : 'pending',
            recipient: 'So11111111111111111111111111111111111111112',
            quote: { usdPrice: '100', blockId: 123 },
            expiresAt: Date.now() + 900_000,
            rpcUrl: 'https://api.devnet.solana.com',
            memo: `crypto_gateway:${id}`,
            network: 'solana-devnet',
            attempts: submitted
              ? [{ signature: '1'.repeat(64), state: 'pending', reason: null }]
              : [],
            signature: settled ? '1'.repeat(64) : null,
          },
        },
      });
    });
    await page.goto(`/checkout/${id}#${'a'.repeat(64)}`);
    await page.getByRole('button', { name: 'Connect wallet' }).click();
    await page.waitForFunction(() => 'approveFixtureWallet' in window);
    await page.evaluate(() =>
      (
        window as unknown as {
          /** Complete the deferred fixture-wallet connection. */
          approveFixtureWallet(): void;
        }
      ).approveFixtureWallet(),
    );
    await page.evaluate(() => {
      delete (window as unknown as { approveFixtureWallet?: unknown })
        .approveFixtureWallet;
    });
    await expect(
      page.getByRole('button', { name: 'Pay with SOL' }),
    ).toBeEnabled();
    expect(rpcMethods).toEqual([]);
    await page.getByRole('button', { name: 'Pay with SOL' }).click();
    await expect(page.locator('[aria-current="step"]')).toHaveText(
      'Wallet approval',
    );
    await page.waitForFunction(() => 'approveFixtureWallet' in window);
    await page.evaluate(() =>
      (
        window as unknown as {
          /** Approve the sender's account revalidation. */ approveFixtureWallet(): void;
        }
      ).approveFixtureWallet(),
    );
    if (loseResponse) {
      await expect(page.getByRole('alert')).toContainText(
        'Your transaction was submitted. Refresh status; do not pay again.',
      );
      expect(
        await page.evaluate(
          (id) => sessionStorage.getItem(`crypto_gateway:signature:${id}`),
          id,
        ),
      ).toBe('1'.repeat(64));
      await page.reload();
      recoverSubmission = true;
      await page.getByRole('button', { name: 'Refresh status' }).click();
      await expect.poll(() => submitted).toBe(true);
      await expect(
        page.getByRole('button', { name: 'Pay with SOL' }),
      ).toHaveCount(0);
    }
    await expect(page.locator('[aria-current="step"]')).toHaveText(
      'On-chain verification',
    );
    await expect(
      page.getByText('The backend confirmed your payment.'),
    ).toHaveCount(0);
    settled = true;
    await page.getByRole('button', { name: 'Refresh status' }).click();
    await expect(page.locator('[aria-current="step"]')).toHaveText(
      'On-chain verification',
    );
    expect(rpcMethods).toEqual(['getGenesisHash', 'getLatestBlockhash']);
    await expect(
      page.getByRole('dialog', { name: 'Payment verified' }),
    ).toBeVisible();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .last()
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'View payment status' }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Pay with SOL' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'View payment status' }).click();
    await expect(
      page.getByRole('dialog', { name: 'Payment verified' }),
    ).toBeVisible();
    expect(walletSends).toBe(1);
    if (responseLoss === 'unrecorded')
      expect(submissions.length).toBeGreaterThanOrEqual(2);
    else expect(submissions).toHaveLength(1);
    expect(submissions.every((signature) => signature === '1'.repeat(64))).toBe(
      true,
    );
  });
}

test('disabled demo explains availability and blocks payment creation', async ({
  page,
}) => {
  let posts = 0;
  await page.route('**/api/demo/status', (route) =>
    route.fulfill({ json: { data: { enabled: false } } }),
  );
  await page.route('**/api/demo/payments', (route) => {
    posts++;
    return route.abort();
  });
  await page.goto('/');
  await expect(
    page
      .getByRole('region', { name: 'Business', exact: true })
      .getByRole('status'),
  ).toHaveText('Demo payments are disabled.');
  await expect(
    page.getByRole('button', { name: 'Create payment link', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('Cart total (USD)')).toBeDisabled();
  expect(posts).toBe(0);
});

test('USD form creates an inline checkout with three progress steps and a customer-only reload', async ({
  page,
}) => {
  const id = '11111111-1111-4111-8111-111111111111';
  await page.route('**/api/demo/status', async (route) => {
    expect(route.request().method()).toBe('GET');
    await route.fulfill({ json: { data: { enabled: true } } });
  });
  await page.route('**/api/demo/payments', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ usdCents: 1234 });
    expect(route.request().headers().authorization).toBeUndefined();
    await route.fulfill({
      json: {
        data: {
          checkoutUrl: `${test.info().project.use.baseURL}/checkout/${id}#${'a'.repeat(64)}`,
        },
      },
    });
  });
  await page.route('**/v1/checkout/**', async (route) => {
    await route.fulfill({
      headers: {
        'access-control-allow-origin': test.info().project.use.baseURL!,
        'access-control-allow-headers': 'authorization',
      },
      json: {
        data: {
          id,
          usdCents: 1234,
          displaySol: '0.082266667',
          lamports: '82266667',
          memo: `crypto_gateway:${id}`,
          status: 'pending',
          recipient: 'So11111111111111111111111111111111111111112',
          quote: { usdPrice: '100', blockId: 123 },
          expiresAt: Date.now() + 900_000,
          network: 'solana-devnet',
          attempts: [],
          signature: null,
        },
      },
    });
  });
  await page.goto('/');
  await page.getByLabel('Cart total (USD)').fill('12.34');
  await page
    .getByRole('button', { name: 'Create payment link', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: '$12.34 USD' })).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Payment progress' }).getByRole('listitem'),
  ).toHaveCount(3);
  await expect(page.getByLabel('Cart total (USD)')).toBeDisabled();
  await expect(page.getByRole('combobox', { name: 'Network' })).toBeDisabled();
  await expect(page.getByText('Created · amount locked')).toBeVisible();
  await expect(
    page.getByText('Your payment link is ready to share.'),
  ).toBeVisible();
  await expect(page.getByText('Waiting for checkout creation')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Checkout link handoff' }),
  ).toContainText(`/checkout/${id}`);
  await expect(page.locator('body')).not.toContainText('a'.repeat(64));
  expect(new URL(page.url()).hash).toBe('');
  await page.reload();
  await expect(page.getByRole('heading', { name: '$12.34 USD' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Business', exact: true }),
  ).toHaveCount(0);
});
