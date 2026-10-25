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
   */
  constructor(
    message: string,
    public code: string,
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
    error?: { message: string; code: string };
  };
  if (!response.ok || !body.data)
    throw new ApiError(
      body.error?.message ?? 'The request could not be completed.',
      body.error?.code ?? 'UNAVAILABLE',
    );
  return body.data;
}

/** Read backend-confirmed status using the checkout capability and optional cancellation signal.
 * @param id - Payment identifier.
 * @param token - Checkout capability, sent only in the authorization header.
 * @param signal - Optional cancellation signal for the current checkout lifecycle.
 * @returns The backend's current payment state.
 */
export function paymentStatus(
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<Payment> {
  return request(`${origin}/v1/checkout/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
}

/** Submit a wallet-returned signature for verification; submission alone is not settlement.
 * @param id - Payment identifier.
 * @param token - Checkout capability authorizing the submission.
 * @param signature - Candidate signature returned by the wallet.
 * @returns The backend's payment state after recording the candidate.
 */
export function submitSignature(
  id: string,
  token: string,
  signature: string,
): Promise<Payment> {
  return request(`${origin}/v1/checkout/${id}/transactions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ signature }),
  });
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
