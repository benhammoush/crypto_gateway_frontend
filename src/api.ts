/**
 * Browser-to-gateway requests, response errors and payment input parsing.
 * @packageDocumentation
 */

import { Payment } from './types';

const origin =
  import.meta.env.VITE_API_ORIGIN ??
  (import.meta.env.DEV ? 'http://localhost:8787' : '');

/** Public gateway failure with an actionable message and code. */
export class ApiError extends Error {
  /** Retain the public message and code for UI error handling.
   * @param message - Public explanation safe to show in checkout.
   * @param code - Gateway error code for recovery decisions.
   * @param supportReference - Validated reference suffix, or empty for non-gateway failures.
   */
  constructor(
    message: string,
    public code: string,
    public supportReference = '',
  ) {
    super(message);
  }
}

/** Derive the RPC route from trusted gateway configuration, never provider data.
 * @param id - Payment identifier whose checkout capability scopes the RPC route.
 * @returns The gateway URL, without checkout credentials.
 */
export function checkoutRpcUrl(id: string): string {
  return `${origin}/v1/checkout/${encodeURIComponent(id)}/rpc`;
}

/** Fetch JSON and translate unsuccessful gateway responses into the public error contract.
 * @param url - Gateway or same-origin merchant endpoint.
 * @param init - Request options, including any caller cancellation signal.
 * @returns The response data, rejecting on transport or gateway failure.
 */
export async function request<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  const body = (await response.json()) as {
    data?: T;
    error?: { message: string; code: string; requestId?: unknown };
  };
  if (!response.ok || !body.data) {
    const reference = body.error?.requestId;
    const suffix =
      typeof reference === 'string' &&
      reference.length === 36 &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        reference,
      )
        ? ` Request ID: ${reference}.`
        : '';
    throw new ApiError(
      (body.error?.message ?? 'The request could not be completed.') + suffix,
      body.error?.code ?? 'UNAVAILABLE',
      suffix,
    );
  }
  return body.data;
}

/** Read backend-confirmed status using the checkout capability and optional cancellation signal.
 * @param id - Payment identifier.
 * @param token - Checkout capability, sent only in the authorization header.
 * @param signal - Optional cancellation signal for the current checkout lifecycle.
 * @returns The backend's current payment state.
 */
export async function paymentStatus(
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<Payment> {
  return readPayment(
    await request<unknown>(`${origin}/v1/checkout/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    }),
    id,
  );
}

/** Submit a wallet-returned signature for verification; submission alone is not settlement.
 * @param id - Payment identifier.
 * @param token - Checkout capability authorizing the submission.
 * @param signature - Candidate signature returned by the wallet.
 * @returns The backend's payment state after recording the candidate.
 */
export async function submitSignature(
  id: string,
  token: string,
  signature: string,
): Promise<Payment> {
  return readPayment(
    await request<unknown>(
      `${origin}/v1/checkout/${encodeURIComponent(id)}/transactions`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ signature }),
      },
    ),
    id,
  );
}

/** Reject malformed gateway fields before checkout renders or prepares a transfer.
 * @param value - Untrusted successful-response data.
 * @param id - Expected payment identity; other payments must not replace this checkout.
 * @returns A payment with validated checkout and wallet inputs; unused metadata stays server-owned.
 * @throws An API error without response contents when checkout fields are malformed.
 */
function readPayment(value: unknown, id: string): Payment {
  if (!value || typeof value !== 'object')
    throw new ApiError('Unable to read payment status.', 'INVALID_RESPONSE');
  const p = value as Payment;
  if (
    p.id !== id ||
    p.network !== 'solana-devnet' ||
    !Number.isSafeInteger(p.usdCents) ||
    p.usdCents < 1 ||
    p.usdCents > 1_000_000 ||
    typeof p.lamports !== 'string' ||
    !/^[1-9][0-9]{0,19}$/.test(p.lamports) ||
    BigInt(p.lamports) > 18_446_744_073_709_551_615n ||
    typeof p.displaySol !== 'string' ||
    p.displaySol !==
      `${BigInt(p.lamports) / 1_000_000_000n}.${String(BigInt(p.lamports) % 1_000_000_000n).padStart(9, '0')}` ||
    typeof p.recipient !== 'string' ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.recipient) ||
    typeof p.memo !== 'string' ||
    !p.memo ||
    p.memo.length > 256 ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.expiresAt < 0 ||
    !['pending', 'verifying', 'settled', 'expired'].includes(p.status) ||
    !(p.signature === null || validSignature(p.signature)) ||
    !Array.isArray(p.attempts) ||
    !p.attempts.every(validAttempt)
  )
    throw new ApiError('Unable to read payment status.', 'INVALID_RESPONSE');
  return p;
}

/** Recognize a bounded Solana signature without treating it as settlement evidence.
 * @param value - Untrusted candidate signature.
 * @returns Whether the value has the supported base58 shape.
 */
function validSignature(value: unknown): value is string {
  return (
    typeof value === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(value)
  );
}

/** Check attempt fields used for recovery and result presentation.
 * @param value - Untrusted verification attempt.
 * @returns Whether it is safe for checkout to inspect the attempt.
 */
function validAttempt(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const attempt = value as Record<string, unknown>;
  return (
    validSignature(attempt.signature) &&
    typeof attempt.state === 'string' &&
    ['pending', 'rejected', 'verified'].includes(attempt.state) &&
    (attempt.reason === null || typeof attempt.reason === 'string')
  );
}

/** Parse user input without floating-point multiplication.
 * @param value - USD amount with at most two decimal places.
 * @returns Integer USD cents, rejecting amounts outside the supported range.
 */
export function parseUsd(value: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value))
    throw new Error('Enter a USD amount with at most two decimals.');
  const [dollars, cents = ''] = value.split('.');
  const result = Number(dollars) * 100 + Number((cents + '00').slice(0, 2));
  if (result < 1 || result > 1_000_000)
    throw new Error('Enter between $0.01 and $10,000.00.');
  return result;
}
