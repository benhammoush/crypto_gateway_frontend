// @vitest-environment jsdom
/**
 * Checkout recovery, polling and duplicate-submission protection regressions.
 * @packageDocumentation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render as renderReact,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { parseUsd, paymentStatus, submitSignature } from '../../src/api';
import { Checkout } from '../../src/App';
import { Payment, PROGRESS } from '../../src/types';
import {
  connectWallet,
  sendPayment,
  WalletSubmissionUncertain,
} from '../../src/wallet';
import { ConfigProvider } from '../../src/design-system';
import type { ReactNode } from 'react';

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof import('../../src/api')>()),
  paymentStatus: vi.fn(),
  submitSignature: vi.fn(),
}));
vi.mock('../../src/wallet', async (original) => ({
  ...(await original<typeof import('../../src/wallet')>()),
  sendPayment: vi.fn(),
  connectWallet: vi.fn(),
}));

let payment: Payment;

/** Use the production motion setting so jsdom does not wait for unavailable CSS transitions.
 * @param ui - Checkout tree under test.
 * @returns The mounted checkout and cleanup helpers.
 */
function render(ui: ReactNode) {
  return renderReact(
    <ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>,
  );
}

/** Connect first, then request one separate wallet-approved payment. */
async function pay() {
  fireEvent.click(
    await screen.findByRole('button', { name: 'Connect wallet' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pay with SOL' })
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Pay with SOL' }));
}

beforeEach(() => {
  vi.mocked(connectWallet).mockResolvedValue('1'.repeat(32));
  const now = Date.now();
  payment = {
    id: 'fixture-payment',
    merchantReference: 'reference',
    usdCents: 1000,
    lamports: '100000000',
    displaySol: '0.100000000',
    network: 'solana-devnet',
    asset: 'SOL',
    recipient: 'recipient',
    memo: 'memo',
    rpcUrl: 'https://api.devnet.solana.com',
    createdAt: now,
    quote: { usdPrice: '100', blockId: 123 },
    settledAt: null,
    expiresAt: now + 900_000,
    status: 'pending',
    signature: null,
    attempts: [],
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

describe('reference form', () => {
  it('parses USD without floating-point rounding', () => {
    expect(parseUsd('10.01')).toBe(1001);
    expect(parseUsd('0.29')).toBe(29);
    expect(parseUsd('10000')).toBe(1_000_000);
    for (const value of ['0', '-1', '1.001', '1e2', '10000.01'])
      expect(() => parseUsd(value)).toThrow();
  });
});

describe('checkout', () => {
  it('connects without sending funds and keeps payment approval separate', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    render(<Checkout id={payment.id} token="token" />);
    const connect = await screen.findByRole('button', {
      name: 'Connect wallet',
    });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pay with SOL' })
        .disabled,
    ).toBe(true);
    fireEvent.click(connect);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', { name: 'Pay with SOL' })
          .disabled,
      ).toBe(false),
    );
    expect(connectWallet).toHaveBeenCalledOnce();
    expect(sendPayment).not.toHaveBeenCalled();
    expect(submitSignature).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem(
        `crypto_gateway:signature:${payment.id}:uncertain`,
      ),
    ).toBeNull();
  });

  it('does not expose wallet connection errors or offer payment before connection succeeds', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(connectWallet).mockRejectedValue(
      new Error('private wallet details'),
    );
    render(<Checkout id={payment.id} token="token" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Connect wallet' }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'No payment was requested.',
    );
    expect(document.body.textContent).not.toContain('private wallet details');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Pay with SOL' })
        .disabled,
    ).toBe(true);
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('can dismiss and reopen the submitted receipt without sending again', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockResolvedValue('1'.repeat(64));
    vi.mocked(submitSignature).mockImplementation(() => new Promise(() => {}));
    render(<Checkout id={payment.id} token="token" />);
    await pay();
    const dialog = await screen.findByRole('dialog', {
      name: 'Transaction submitted',
    });
    expect(
      within(dialog).getByText(
        'Your payment was sent. Waiting for verification.',
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByRole<HTMLAnchorElement>('link', {
        name: /View transaction/,
      }).href,
    ).toBe(`https://explorer.solana.com/tx/${'1'.repeat(64)}?cluster=devnet`);
    fireEvent.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Pay with SOL' })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'View payment status' }),
    );
    await screen.findByRole('dialog', { name: 'Transaction submitted' });
    expect(sendPayment).toHaveBeenCalledExactlyOnceWith(
      payment,
      'token',
      '1'.repeat(32),
    );
    expect(submitSignature).toHaveBeenCalledOnce();
  });

  it('does not re-enable payment when the server already recorded a rejected attempt', async () => {
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      attempts: [
        {
          signature: '1'.repeat(64),
          state: 'rejected',
          reason: 'INVALID_TRANSFER',
        },
      ],
    });
    render(<Checkout id={payment.id} token="token" />);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Pay with SOL' })).toBeNull();
    expect(sendPayment).not.toHaveBeenCalled();
  });

  it('keeps the backend quote exact and recipient read-only with no EVM defaults', async () => {
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      lamports: '9007199254740993',
      displaySol: '9007199.254740993',
    });
    render(<Checkout id={payment.id} token="token" />);
    expect(await screen.findByText('9007199.254740993 SOL')).toBeTruthy();
    expect(screen.getByText(payment.recipient, { exact: false })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.body.textContent).not.toMatch(/ETH|0xrecipient/);
    expect(
      within(
        screen.getByRole('list', { name: 'Payment progress' }),
      ).getAllByRole('listitem'),
    ).toHaveLength(3);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe(
      'Wallet approval',
    );
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it('shows dev-only hints and timing after a failure and reload without another submission', async () => {
    vi.stubEnv('VITE_APP_ENV', 'dev');
    const details = {
      reason: 'BLOCKHASH_EXPIRED_OR_MISSING' as const,
      walletSeconds: 125,
      blockhashSeconds: 127,
      quoteExpired: false,
    };
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockRejectedValue(
      new WalletSubmissionUncertain(
        'Check wallet activity before paying again.',
        undefined,
        'WALLET_RPC_-32603',
        details,
      ),
    );
    const first = render(<Checkout id={payment.id} token="token" />);
    await pay();
    expect((await screen.findByRole('status')).textContent).toContain(
      'Dev wallet hint: BLOCKHASH_EXPIRED_OR_MISSING',
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Wallet wait: 125s. Time since blockhash fetched: 127s.',
    );
    expect(screen.getByRole('status').textContent).toContain(
      'Quote expired at error: no',
    );
    expect(
      JSON.parse(
        sessionStorage.getItem(
          `crypto_gateway:signature:${payment.id}:walletFailure`,
        )!,
      ),
    ).toEqual(details);
    first.unmount();
    render(<Checkout id={payment.id} token="token" />);
    expect((await screen.findByRole('status')).textContent).toContain(
      'Dev wallet hint: BLOCKHASH_EXPIRED_OR_MISSING',
    );
    fireEvent.click(screen.getByText('Refresh status'));
    await waitFor(() => expect(paymentStatus).toHaveBeenCalled());
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sendPayment).toHaveBeenCalledOnce();
    expect(submitSignature).not.toHaveBeenCalled();
  });
  it.each(['local', 'production'])(
    'does not collect or display extra wallet details in %s',
    async (environment) => {
      vi.stubEnv('VITE_APP_ENV', environment);
      const details = {
        reason: 'INSUFFICIENT_FUNDS' as const,
        walletSeconds: 1,
        blockhashSeconds: 2,
        quoteExpired: false,
      };
      vi.mocked(paymentStatus).mockResolvedValue(payment);
      vi.mocked(sendPayment).mockRejectedValue(
        new WalletSubmissionUncertain(
          'Check wallet activity before paying again.',
          undefined,
          'WALLET_RPC_-32603',
          details,
        ),
      );
      const first = render(<Checkout id={payment.id} token="token" />);
      await pay();
      await screen.findByRole('status');
      expect(screen.queryByText(/Dev wallet hint/)).toBeNull();
      expect(
        sessionStorage.getItem(
          `crypto_gateway:signature:${payment.id}:walletFailure`,
        ),
      ).toBeNull();
      first.unmount();
      sessionStorage.setItem(
        `crypto_gateway:signature:${payment.id}:walletFailure`,
        JSON.stringify(details),
      );
      render(<Checkout id={payment.id} token="token" />);
      await screen.findByRole('status');
      expect(screen.queryByText(/Dev wallet hint/)).toBeNull();
      expect(screen.queryByText('Pay with SOL')).toBeNull();
      expect(sendPayment).toHaveBeenCalledOnce();
    },
  );
  it('does not render malformed stored dev details or release the uncertainty guard', async () => {
    vi.stubEnv('VITE_APP_ENV', 'dev');
    const key = `crypto_gateway:signature:${payment.id}`;
    sessionStorage.setItem(`${key}:uncertain`, 'true');
    sessionStorage.setItem(
      `${key}:walletFailure`,
      JSON.stringify({
        reason: 'secret-provider-payload',
        walletSeconds: 'secret',
        blockhashSeconds: 2,
        quoteExpired: false,
      }),
    );
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    render(<Checkout id={payment.id} token="token" />);
    await screen.findByRole('status');
    expect(screen.queryByText(/secret-provider-payload/)).toBeNull();
    expect(screen.queryByText(/Dev wallet hint/)).toBeNull();
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sessionStorage.getItem(`${key}:uncertain`)).toBe('true');
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it('blocks a second transfer after uncertain wallet submission', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockRejectedValue(
      new WalletSubmissionUncertain(
        'Check wallet activity before paying again.',
        undefined,
        'WALLET_RPC_-32603',
      ),
    );
    const first = render(<Checkout id={payment.id} token="token" />);
    await pay();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Check wallet activity before paying again.',
    );
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(
      'WALLET_RPC_-32603',
    );
    expect(
      sessionStorage.getItem(
        `crypto_gateway:signature:${payment.id}:walletDiagnostic`,
      ),
    ).toBe('WALLET_RPC_-32603');
    first.unmount();
    render(<Checkout id={payment.id} token="token" />);
    expect((await screen.findByRole('status')).textContent).toContain(
      'WALLET_RPC_-32603',
    );
    fireEvent.click(screen.getByText('Refresh status'));
    await waitFor(() => expect(paymentStatus).toHaveBeenCalled());
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sendPayment).toHaveBeenCalledOnce();
  });
  it('never renders unrecognized stored diagnostics or clears the uncertainty guard', async () => {
    const key = `crypto_gateway:signature:${payment.id}`;
    sessionStorage.setItem(`${key}:uncertain`, 'true');
    sessionStorage.setItem(
      `${key}:walletDiagnostic`,
      'secret-provider-payload',
    );
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    render(<Checkout id={payment.id} token="token" />);
    expect((await screen.findByRole('status')).textContent).toContain(
      'UNAVAILABLE',
    );
    expect(screen.queryByText(/secret-provider-payload/)).toBeNull();
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sessionStorage.getItem(`${key}:uncertain`)).toBe('true');
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it('checks wallet method availability without invoking the provider or retrying', async () => {
    const key = `crypto_gateway:signature:${payment.id}`;
    sessionStorage.setItem(`${key}:uncertain`, 'true');
    const request = vi.fn();
    const connect = vi.fn();
    const signAndSendTransaction = vi.fn();
    const phantom = { solana: { request, connect, signAndSendTransaction } };
    vi.stubGlobal('phantom', phantom);
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    try {
      render(<Checkout id={payment.id} token="token" />);
      expect((await screen.findByRole('status')).textContent).toContain(
        'Wallet API check: request available; direct sender available.',
      );
      expect(request).not.toHaveBeenCalled();
      expect(connect).not.toHaveBeenCalled();
      expect(signAndSendTransaction).not.toHaveBeenCalled();
      expect(sendPayment).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(`${key}:uncertain`)).toBe('true');
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('does not open the wallet if the reload guard cannot be persisted', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockResolvedValue('signature');
    vi.mocked(submitSignature).mockRejectedValue(
      new Error('network unavailable'),
    );
    render(<Checkout id={payment.id} token="token" />);
    await pay();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Enable session storage before submitting a payment safely.',
    );
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it('blocks another transfer after reloading with the wallet promise still pending', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockImplementation(
      () => new Promise<string>(() => {}),
    );
    const first = render(<Checkout id={payment.id} token="token" />);
    await pay();
    await waitFor(() => expect(sendPayment).toHaveBeenCalledOnce());
    expect(
      sessionStorage.getItem(
        `crypto_gateway:signature:${payment.id}:uncertain`,
      ),
    ).toBe('true');
    first.unmount();
    render(<Checkout id={payment.id} token="token" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sendPayment).toHaveBeenCalledOnce();
  });
  it('keeps four lifecycle events separate from the three visual stages', () => {
    expect(PROGRESS).toEqual([
      'Awaiting wallet approval',
      'Transaction submitted',
      'Verifying on-chain',
      'Payment verified',
    ]);
  });
  it('does not treat wallet submission as verified payment', async () => {
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(sendPayment).mockResolvedValue('signature');
    vi.mocked(submitSignature).mockResolvedValue({
      ...payment,
      status: 'verifying',
    });
    render(<Checkout id={payment.id} token="token" />);
    await pay();
    await waitFor(() =>
      expect(
        screen
          .getByRole('listitem', { name: 'On-chain verification' })
          .getAttribute('aria-current'),
      ).toBe('step'),
    );
    expect(
      screen.queryByRole('dialog', { name: 'Payment verified' }),
    ).toBeNull();
    expect(
      screen.getByRole('list', { name: 'Payment progress' }).textContent,
    ).not.toContain('Transaction submitted');
  });
  it('shows verified only from backend settlement', async () => {
    const key = `crypto_gateway:signature:${payment.id}`;
    sessionStorage.setItem(`${key}:uncertain`, 'true');
    sessionStorage.setItem(`${key}:walletDiagnostic`, 'WALLET_RPC_-32603');
    sessionStorage.setItem(`${key}:walletFailure`, '{}');
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      status: 'settled',
      signature: 'signature',
    });
    render(<Checkout id={payment.id} token="token" />);
    expect(
      await screen.findByText('The backend confirmed your payment.'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('listitem', { name: 'On-chain verification' })
        .getAttribute('aria-current'),
    ).toBe('step');
    const explorer = screen.getByRole<HTMLAnchorElement>('link', {
      name: /View transaction on Solana Explorer/,
    });
    expect(explorer.href).toBe(
      'https://explorer.solana.com/tx/signature?cluster=devnet',
    );
    expect(screen.queryByText(/Quote locked/)).toBeNull();
    expect(sessionStorage.getItem(`${key}:walletDiagnostic`)).toBeNull();
    expect(sessionStorage.getItem(`${key}:walletFailure`)).toBeNull();
    expect(sessionStorage.getItem(`${key}:uncertain`)).toBeNull();
  });
  it('resubmits a saved signature after refresh without prompting another transfer', async () => {
    sessionStorage.setItem(
      `crypto_gateway:signature:${payment.id}`,
      'signature',
    );
    vi.mocked(paymentStatus).mockResolvedValue(payment);
    vi.mocked(submitSignature).mockResolvedValue({
      ...payment,
      status: 'verifying',
    });
    render(<Checkout id={payment.id} token="token" />);
    await waitFor(() =>
      expect(submitSignature).toHaveBeenCalledWith(
        payment.id,
        'token',
        'signature',
      ),
    );
    expect(screen.queryByText('Pay with SOL')).toBeNull();
    expect(sendPayment).not.toHaveBeenCalled();
  });
  it('does not describe loss of connectivity as failed payment', async () => {
    vi.mocked(paymentStatus).mockRejectedValue(new Error('network'));
    render(<Checkout id={payment.id} token="token" />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Unable to refresh payment status. Your payment has not been marked failed.',
    );
  });
  it('does not offer a new transfer for an expired quote', async () => {
    vi.mocked(paymentStatus).mockResolvedValue({
      ...payment,
      status: 'expired',
      expiresAt: Date.now() - 1,
    });
    render(<Checkout id={payment.id} token="token" />);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This quote has expired. Do not send a new transfer. If you already paid, contact the merchant.',
    );
    expect(screen.queryByText('Pay with SOL')).toBeNull();
  });
});
