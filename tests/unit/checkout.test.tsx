// @vitest-environment jsdom
/**
 * Checkout recovery, polling and duplicate-submission protection regressions.
 * @packageDocumentation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { parseUsd, paymentStatus, submitSignature } from '../../src/api';
import { Checkout } from '../../src/App';
import { Payment, PROGRESS } from '../../src/types';
import { sendPayment, WalletSubmissionUncertain } from '../../src/wallet';

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof import('../../src/api')>()),
  paymentStatus: vi.fn(),
  submitSignature: vi.fn(),
}));
vi.mock('../../src/wallet', async (original) => ({
  ...(await original<typeof import('../../src/wallet')>()),
  sendPayment: vi.fn(),
}));

let payment: Payment;

beforeEach(() => {
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
    fireEvent.click(await screen.findByText('Pay with Phantom'));
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
      fireEvent.click(await screen.findByText('Pay with Phantom'));
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
      expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    fireEvent.click(await screen.findByText('Pay with Phantom'));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Check wallet activity before paying again.',
    );
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    fireEvent.click(await screen.findByText('Pay with Phantom'));
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
    fireEvent.click(await screen.findByText('Pay with Phantom'));
    await waitFor(() => expect(sendPayment).toHaveBeenCalledOnce());
    expect(
      sessionStorage.getItem(
        `crypto_gateway:signature:${payment.id}:uncertain`,
      ),
    ).toBe('true');
    first.unmount();
    render(<Checkout id={payment.id} token="token" />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
    expect(sendPayment).toHaveBeenCalledOnce();
  });
  it('contains exactly the four agreed notifications', () => {
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
    fireEvent.click(await screen.findByText('Pay with Phantom'));
    await waitFor(() =>
      expect(
        screen.getByText('Verifying on-chain').getAttribute('aria-current'),
      ).toBe('step'),
    );
    expect(
      screen.getByText('Payment verified').getAttribute('aria-current'),
    ).toBeNull();
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
      await screen.findByText(
        'Verified testnet transfer. No real funds were used.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Payment verified').getAttribute('aria-current'),
    ).toBe('step');
    expect(screen.queryByRole('status')).toBeNull();
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
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
    expect(screen.queryByText('Pay with Phantom')).toBeNull();
  });
});
