// @vitest-environment jsdom
/**
 * Merchant form and checkout navigation regressions.
 * @packageDocumentation
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import App from '../../src/App';
import { paymentStatus, request } from '../../src/api';
import type { Payment } from '../../src/types';

vi.mock('../../src/api', async (original) => ({
  ...(await original<typeof import('../../src/api')>()),
  request: vi.fn(),
  paymentStatus: vi.fn(),
}));

afterEach(() => {
  cleanup();
  history.replaceState(null, '', '/');
  sessionStorage.clear();
  vi.resetAllMocks();
});

/** Disabled form controls alone must not be the submission guard. */
function submit() {
  fireEvent.submit(
    screen
      .getByRole('button', { name: /^Create payment link$/ })
      .closest('form')!,
  );
}

describe('server-reported demo availability', () => {
  it('activates checkout inline, hides the capability and locks business controls and network', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const capability = 'a'.repeat(64);
    const checkoutUrl = `${location.origin}/checkout/${id}#${capability}`;
    vi.mocked(request)
      .mockResolvedValueOnce({ enabled: true })
      .mockResolvedValueOnce({ checkoutUrl });
    vi.mocked(paymentStatus).mockResolvedValue({
      id,
      merchantReference: 'order',
      usdCents: 1000,
      lamports: '100000000',
      displaySol: '0.100000000',
      network: 'solana-devnet',
      asset: 'SOL',
      recipient: 'recipient',
      memo: 'memo',
      rpcUrl: 'https://api.devnet.solana.com',
      createdAt: Date.now(),
      quote: { usdPrice: '100', blockId: 1 },
      settledAt: null,
      expiresAt: Date.now() + 900000,
      status: 'pending',
      signature: null,
      attempts: [],
    } satisfies Payment);
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: 'Create payment link',
        }).disabled,
      ).toBe(false),
    );
    submit();
    await screen.findByText('Created · amount locked');
    await screen.findByText('0.100000000 SOL');
    expect(
      screen.getByLabelText<HTMLInputElement>('Cart total (USD)').disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLInputElement>('combobox', { name: 'Network' })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole('region', { name: 'Checkout link handoff' }).textContent,
    ).toContain(`/checkout/${id}`);
    expect(document.body.textContent).not.toContain(capability);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe(`/checkout/${id}`);
    expect(sessionStorage.getItem(`crypto_gateway:session:${id}`)).toBe(
      capability,
    );
    fireEvent.submit(
      screen.getByLabelText('Cart total (USD)').closest('form')!,
    );
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    'https://other.example/checkout/11111111-1111-4111-8111-111111111111#' +
      'a'.repeat(64),
    `${location.origin}/checkout/11111111-1111-4111-8111-111111111111#invalid`,
    `${location.origin}/checkout/11111111-1111-4111-8111-111111111111?unexpected=value#` +
      'a'.repeat(64),
  ])(
    'does not unlock checkout for an untrusted destination',
    async (checkoutUrl) => {
      vi.mocked(request)
        .mockResolvedValueOnce({ enabled: true })
        .mockResolvedValueOnce({ checkoutUrl });
      render(<App />);
      await waitFor(() =>
        expect(
          screen.getByRole<HTMLButtonElement>('button', {
            name: 'Create payment link',
          }).disabled,
        ).toBe(false),
      );
      submit();
      await screen.findByRole('alert');
      expect(paymentStatus).not.toHaveBeenCalled();
      expect(location.pathname).toBe('/');
      expect(screen.queryByText('Created · amount locked')).toBeNull();
    },
  );

  it('blocks payment while the initial status check is pending', () => {
    vi.mocked(request).mockImplementation(() => new Promise(() => {}));
    render(<App />);
    expect(
      within(screen.getByRole('region', { name: 'Business' })).getByRole(
        'status',
      ).textContent,
    ).toBe('Checking demo availability…');
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /^Create payment link$/,
      }).disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>('Cart total (USD)').disabled,
    ).toBe(true);
    submit();
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = vi.mocked(request).mock.calls[0];
    expect(url).toBe('/api/demo/status');
    expect(options).toMatchObject({ method: 'GET', cache: 'no-store' });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('shows disabled mode and never posts a payment, including a synthetic form submit', async () => {
    vi.mocked(request).mockResolvedValue({ enabled: false });
    render(<App />);
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Business' })).getByRole(
          'status',
        ).textContent,
      ).toBe('Demo payments are disabled.'),
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: /^Create payment link$/,
      }).disabled,
    ).toBe(true);
    submit();
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { enabled: 'true' }, { enabled: 1 }])(
    'fails closed on malformed status %j',
    async (value) => {
      vi.mocked(request).mockResolvedValue(value);
      render(<App />);
      await waitFor(() =>
        expect(
          within(screen.getByRole('region', { name: 'Business' })).getByRole(
            'status',
          ).textContent,
        ).toContain('Demo availability could not be checked.'),
      );
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: /^Create payment link$/,
        }).disabled,
      ).toBe(true);
      submit();
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it('fails closed on a network error without exposing its message', async () => {
    vi.mocked(request).mockRejectedValue(
      new Error('private-provider-diagnostic'),
    );
    render(<App />);
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Business' })).getByRole(
          'status',
        ).textContent,
      ).toContain('Demo availability could not be checked.'),
    );
    expect(document.body.textContent).not.toContain(
      'private-provider-diagnostic',
    );
    submit();
    expect(request).toHaveBeenCalledOnce();
  });

  it('enables the existing form only for literal true without automatically creating a payment', async () => {
    vi.mocked(request).mockResolvedValue({ enabled: true });
    const view = render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: /^Create payment link$/,
        }).disabled,
      ).toBe(false),
    );
    expect(
      within(screen.getByRole('region', { name: 'Business' })).queryByRole(
        'status',
      ),
    ).toBeNull();
    expect(
      within(screen.getByRole('region', { name: 'Customer' })).getByRole(
        'status',
      ).textContent,
    ).toContain('Waiting for checkout creation');
    expect(request).toHaveBeenCalledOnce();
    const signal = vi.mocked(request).mock.calls[0][1]!.signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  });

  it('shows sanitized creation diagnostics without retrying automatically or changing the same-amount retry key', async () => {
    const message =
      'Unable to create payment. Retry with the same amount. Diagnostic: RPC_UNAVAILABLE. Request ID: 22222222-2222-4222-8222-222222222222.';
    vi.mocked(request)
      .mockResolvedValueOnce({ enabled: true })
      .mockRejectedValue(new Error(message));
    render(<App />);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLButtonElement>('button', {
          name: /^Create payment link$/,
        }).disabled,
      ).toBe(false),
    );
    submit();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(message),
    );
    expect(request).toHaveBeenCalledTimes(2);
    const first = vi.mocked(request).mock.calls[1][1]!;
    submit();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    expect(vi.mocked(request).mock.calls[2][1]).toMatchObject({
      headers: first.headers,
      body: first.body,
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(message),
    );
  });
});
