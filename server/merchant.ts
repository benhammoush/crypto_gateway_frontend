/**
 * Credential-isolated merchant requests and authenticated settlement webhooks.
 * @packageDocumentation
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const seenEvents = new Set<string>();
const paymentErrorCodes = new Set([
  'UNAUTHORIZED',
  'NOT_CONFIGURED',
  'PAYMENTS_DISABLED',
  'ORIGIN_REJECTED',
  'RATE_LIMITED',
  'INVALID_REQUEST',
  'INVALID_IDEMPOTENCY_KEY',
  'IDEMPOTENCY_CONFLICT',
  'PRICE_UNAVAILABLE',
  'RPC_UNAVAILABLE',
  'WRONG_NETWORK',
  'INTERNAL_ERROR',
]);

/** Minimal server-only adapter, intentionally separate from the browser bundle.
 * @param req - Incoming merchant request; credentials remain server-side.
 * @param res - Response receiving only controlled public fields.
 * @returns Completion after responding; failures are translated to public errors.
 */
export async function merchantHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  /** Return a controlled adapter error; allowlisted codes and valid request IDs may appear, never credentials or raw upstream bodies.
   * @param status - HTTP error status.
   * @param message - Controlled public explanation, never raw upstream content.
   */
  const fail = (status: number, message: string) => {
    res.statusCode = status;
    res.end(JSON.stringify({ error: { code: 'DEMO_ERROR', message } }));
  };
  try {
    if (req.url?.split('?')[0] === '/api/demo/status') {
      if (req.method !== 'GET') return fail(405, 'Use a GET request.');
      // Public UI hint only: no credential/configuration values or upstream calls.
      res.end(
        JSON.stringify({
          data: { enabled: process.env.DEMO_ENABLED === 'true' },
        }),
      );
      return;
    }
    if (
      req.method !== 'POST' ||
      !req.headers['content-type']?.startsWith('application/json')
    )
      return fail(405, 'Use a JSON POST request.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunkValue of req) {
      const value: unknown = chunkValue;
      if (typeof value !== 'string' && !(value instanceof Uint8Array))
        return fail(400, 'Invalid request body.');
      const chunk =
        typeof value === 'string' ? Buffer.from(value) : Buffer.from(value);
      size += chunk.length;
      if (size > 4096) return fail(413, 'Request body is too large.');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (req.url?.split('?')[0] === '/api/demo/webhook') {
      const secret = process.env.DEMO_WEBHOOK_SECRET;
      const header = req.headers['crypto-gateway-signature'];
      const match =
        typeof header === 'string'
          ? /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header)
          : null;
      if (
        !secret ||
        secret.length < 32 ||
        !match ||
        Math.abs(Date.now() / 1000 - Number(match[1])) > 300
      )
        return fail(401, 'Invalid webhook.');
      const expected = createHmac('sha256', secret)
        .update(`${match[1]}.${raw}`)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex')))
        return fail(401, 'Invalid webhook.');
      const event = JSON.parse(raw) as { id?: string; type?: string };
      if (!event.id || event.type !== 'payment.settled')
        return fail(400, 'Invalid event.');
      // Demonstration acknowledgment only. Real fulfillment needs durable deduplication.
      const duplicate = seenEvents.has(event.id);
      if (seenEvents.size >= 1000) seenEvents.clear();
      seenEvents.add(event.id);
      res.end(JSON.stringify({ data: { acknowledged: true, duplicate } }));
      return;
    }
    if (req.url?.split('?')[0] !== '/api/demo/payments')
      return fail(404, 'Endpoint not found.');
    if (process.env.DEMO_ENABLED !== 'true')
      return fail(503, 'The integration example is not configured yet.');
    const configuredOrigin = process.env.DEMO_FRONTEND_ORIGIN ?? '';
    const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? '';
    const frontend = new URL(configuredOrigin);
    const gateway = new URL(gatewayOrigin);
    const isLocal = ['localhost', '127.0.0.1'].includes(frontend.hostname);
    if (
      frontend.origin !== configuredOrigin ||
      gateway.origin !== gatewayOrigin ||
      (isLocal
        ? !['localhost', '127.0.0.1'].includes(gateway.hostname) ||
          gateway.protocol !== 'http:'
        : frontend.protocol !== 'https:' || gateway.protocol !== 'https:') ||
      req.headers.origin !== configuredOrigin
    )
      return fail(403, 'Origin is not approved.');
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
      return fail(400, 'Invalid idempotency key.');
    const input = JSON.parse(raw) as { usdCents?: unknown };
    if (
      Object.keys(input).length !== 1 ||
      typeof input.usdCents !== 'number' ||
      !Number.isSafeInteger(input.usdCents) ||
      input.usdCents < 1 ||
      input.usdCents > 1_000_000
    )
      return fail(400, 'Invalid USD amount.');
    const credential = process.env.DEMO_MERCHANT_API_KEY;
    if (!credential || credential.length < 32)
      return fail(503, 'Merchant credentials are not configured.');
    const upstream = await fetch(`${gatewayOrigin}/v1/payments`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
        'idempotency-key': key,
      },
      body: JSON.stringify({
        usdCents: input.usdCents,
        merchantReference: `demo:${key}`,
      }),
    });
    const result = (await upstream.json()) as {
      data?: { checkoutUrl?: string };
      error?: { code?: unknown; requestId?: unknown };
    } | null;
    if (!upstream.ok || !result?.data?.checkoutUrl) {
      let message = 'Unable to create payment. Retry with the same amount.';
      const code = result?.error?.code;
      // Never forward upstream messages, URLs or payloads into the public demo.
      if (
        !upstream.ok &&
        typeof code === 'string' &&
        paymentErrorCodes.has(code)
      ) {
        message += ` Diagnostic: ${code}.`;
        const requestId = result?.error?.requestId;
        if (
          typeof requestId === 'string' &&
          requestId.length === 36 &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            requestId,
          )
        )
          message += ` Request ID: ${requestId}.`;
      }
      return fail(upstream.status === 429 ? 429 : 503, message);
    }
    const checkout = new URL(result.data.checkoutUrl);
    if (checkout.origin !== configuredOrigin)
      return fail(
        503,
        'Checkout configuration does not match this application.',
      );
    res.end(JSON.stringify({ data: { checkoutUrl: checkout.href } }));
  } catch {
    fail(503, 'The example service is temporarily unavailable.');
  }
}
