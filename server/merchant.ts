import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { gatewayAccessHeaders, gatewayJson } from "./gateway.js";

const seenEvents = new Set<string>();

/** Minimal server-only adapter, intentionally separate from the browser bundle. */
export async function merchantHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  const fail = (status: number, message: string) => {
    res.statusCode = status;
    res.end(JSON.stringify({ error: { code: "DEMO_ERROR", message } }));
  };
  try {
    if (req.url?.split("?")[0] === "/api/demo/status") {
      if (req.method !== "GET") return fail(405, "Use a GET request.");
      // Public UI hint only: no credential/configuration values or upstream calls.
      res.end(
        JSON.stringify({
          data: { enabled: process.env.DEMO_ENABLED === "true" },
        }),
      );
      return;
    }
    if (
      req.method !== "POST" ||
      !req.headers["content-type"]?.startsWith("application/json")
    )
      return fail(405, "Use a JSON POST request.");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const value of req) {
      const chunk = Buffer.from(value);
      size += chunk.length;
      if (size > 4096) return fail(413, "Request body is too large.");
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (req.url?.split("?")[0] === "/api/demo/webhook") {
      const secret = process.env.DEMO_WEBHOOK_SECRET;
      const header = req.headers["crypto-gateway-signature"];
      const match =
        typeof header === "string"
          ? /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header)
          : null;
      if (
        !secret ||
        secret.length < 32 ||
        !match ||
        Math.abs(Date.now() / 1000 - Number(match[1])) > 300
      )
        return fail(401, "Invalid webhook.");
      const expected = createHmac("sha256", secret)
        .update(`${match[1]}.${raw}`)
        .digest();
      if (!timingSafeEqual(expected, Buffer.from(match[2], "hex")))
        return fail(401, "Invalid webhook.");
      const event = JSON.parse(raw) as { id?: string; type?: string };
      if (!event.id || event.type !== "payment.settled")
        return fail(400, "Invalid event.");
      // Demonstration acknowledgment only. Real fulfillment needs durable deduplication.
      const duplicate = seenEvents.has(event.id);
      if (seenEvents.size >= 1000) seenEvents.clear();
      seenEvents.add(event.id);
      res.end(JSON.stringify({ data: { acknowledged: true, duplicate } }));
      return;
    }
    if (req.url?.split("?")[0] !== "/api/demo/payments")
      return fail(404, "Endpoint not found.");
    if (process.env.DEMO_ENABLED !== "true")
      return fail(503, "The integration example is not configured yet.");
    const configuredOrigin = process.env.DEMO_FRONTEND_ORIGIN ?? "";
    const gatewayOrigin = process.env.GATEWAY_ORIGIN ?? "";
    const frontend = new URL(configuredOrigin);
    const gateway = new URL(gatewayOrigin);
    const isLocal = ["localhost", "127.0.0.1"].includes(frontend.hostname);
    if (
      frontend.origin !== configuredOrigin ||
      gateway.origin !== gatewayOrigin ||
      (isLocal
        ? !["localhost", "127.0.0.1"].includes(gateway.hostname) ||
          gateway.protocol !== "http:"
        : frontend.protocol !== "https:" || gateway.protocol !== "https:") ||
      req.headers.origin !== configuredOrigin
    )
      return fail(403, "Origin is not approved.");
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(key))
      return fail(400, "Invalid idempotency key.");
    const input = JSON.parse(raw) as { usdCents?: unknown };
    if (
      Object.keys(input).length !== 1 ||
      typeof input.usdCents !== "number" ||
      !Number.isSafeInteger(input.usdCents) ||
      input.usdCents < 1 ||
      input.usdCents > 1_000_000
    )
      return fail(400, "Invalid USD amount.");
    const credential = process.env.DEMO_MERCHANT_API_KEY;
    if (!credential || credential.length < 32)
      return fail(503, "Merchant credentials are not configured.");
    const upstream = await fetch(`${gatewayOrigin}/v1/payments`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: {
        ...gatewayAccessHeaders(gatewayOrigin),
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        "idempotency-key": key,
      },
      body: JSON.stringify({
        usdCents: input.usdCents,
        merchantReference: `demo:${key}`,
      }),
    });
    const { body } = await gatewayJson(upstream);
    const result = body as {
      data?: { checkoutUrl?: string };
    };
    if (!upstream.ok || !result.data?.checkoutUrl)
      return fail(
        upstream.status === 429 ? 429 : 503,
        "Unable to create payment. Retry with the same amount.",
      );
    const checkout = new URL(result.data.checkoutUrl);
    if (checkout.origin !== configuredOrigin)
      return fail(
        503,
        "Checkout configuration does not match this application.",
      );
    res.end(JSON.stringify({ data: { checkoutUrl: checkout.href } }));
  } catch {
    fail(503, "The example service is temporarily unavailable.");
  }
}
