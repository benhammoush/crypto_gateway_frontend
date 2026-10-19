import { Payment } from "./types";

const origin =
  import.meta.env.VITE_APP_ENV === "dev"
    ? `${window.location.origin}/api/gateway`
    : (import.meta.env.VITE_API_ORIGIN ??
      (import.meta.env.DEV ? "http://localhost:8787" : ""));

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

/** Derive the RPC route from trusted gateway configuration, never provider data. */
export function checkoutRpcUrl(id: string): string {
  return `${origin}/v1/checkout/${encodeURIComponent(id)}/rpc`;
}

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
      body.error?.message ?? "The request could not be completed.",
      body.error?.code ?? "UNAVAILABLE",
    );
  return body.data;
}

export function paymentStatus(
  id: string,
  token: string,
  signal?: AbortSignal,
): Promise<Payment> {
  return request(`${origin}/v1/checkout/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
    signal,
  });
}

export function submitSignature(
  id: string,
  token: string,
  signature: string,
): Promise<Payment> {
  return request(
    `${origin}/v1/checkout/${encodeURIComponent(id)}/transactions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ signature }),
    },
  );
}

/** Parse user input without floating-point multiplication. */
export function parseUsd(value: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value))
    throw new Error("Enter a USD amount with at most two decimals.");
  const [dollars, cents = ""] = value.split(".");
  const result = Number(dollars) * 100 + Number((cents + "00").slice(0, 2));
  if (result < 1 || result > 1_000_000)
    throw new Error("Enter between $0.01 and $10,000.00.");
  return result;
}
