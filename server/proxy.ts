import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DEV_FRONTEND,
  DEV_GATEWAY,
  gatewayAccessHeaders,
  gatewayJson,
} from "./gateway.js";

/** Fixed checkout routes only; Vercel Authentication is the human access gate. */
export async function proxyHandler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  const fail = (status: number, code: string) => {
    res.statusCode = status;
    res.end(
      JSON.stringify({
        error: { code, message: "Gateway request unavailable." },
      }),
    );
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Match raw URL, not a normalized URL: no queries, escapes or traversal.
    const match =
      /^\/api\/gateway(\/v1\/checkout\/[a-f0-9-]{36}(\/(?:transactions|rpc))?)$/.exec(
        req.url ?? "",
      );
    if (!match) return fail(404, "NOT_FOUND");
    const method = match[2] ? "POST" : "GET";
    if (req.method !== method) return fail(405, "METHOD_NOT_ALLOWED");
    if (
      (method === "POST" && req.headers.origin !== DEV_FRONTEND) ||
      (req.headers.origin && req.headers.origin !== DEV_FRONTEND)
    )
      return fail(403, "ORIGIN_REJECTED");
    if (
      req.headers["cf-access-client-id"] !== undefined ||
      req.headers["cf-access-client-secret"] !== undefined
    )
      return fail(400, "INVALID_REQUEST");
    const credential = req.headers.authorization;
    if (
      typeof credential !== "string" ||
      !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(credential)
    )
      return fail(401, "UNAUTHORIZED");
    if (process.env.GATEWAY_ORIGIN !== DEV_GATEWAY)
      return fail(503, "NOT_CONFIGURED");
    const headers: Record<string, string> = {
      ...gatewayAccessHeaders(DEV_GATEWAY),
      authorization: credential,
    };
    let body: Buffer | undefined;
    if (method === "POST") {
      if (
        !/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")
      )
        return fail(415, "INVALID_REQUEST");
      headers["content-type"] = "application/json";
      const client = req.headers["solana-client"];
      if (typeof client === "string" && client.length <= 128)
        headers["solana-client"] = client;
      const chunks: Buffer[] = [];
      let size = 0;
      // Bound total input duration, including slow chunked uploads. No retry.
      timer = setTimeout(() => req.destroy(), 10_000);
      timer.unref();
      for await (const value of req) {
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > 4096) return fail(413, "BODY_TOO_LARGE");
        chunks.push(chunk);
      }
      clearTimeout(timer);
      body = Buffer.concat(chunks);
      const parsed: unknown = JSON.parse(body.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return fail(400, "INVALID_REQUEST");
    }
    const upstream = await fetch(`${DEV_GATEWAY}${match[1]}`, {
      method,
      headers,
      ...(body ? { body: new Uint8Array(body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const result = await gatewayJson(upstream);
    // Access denials (including JSON) must not masquerade as gateway responses.
    const error = result.body.error as { code?: unknown } | undefined;
    if (
      !result.body.data &&
      !result.body.jsonrpc &&
      typeof error?.code !== "string"
    )
      return fail(502, "UPSTREAM_UNAVAILABLE");
    res.statusCode = upstream.status;
    for (const name of ["x-request-id", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value && /^[\x20-\x7e]{1,128}$/.test(value))
        res.setHeader(name, value);
    }
    res.end(result.raw);
  } catch {
    fail(503, "UPSTREAM_UNAVAILABLE");
  } finally {
    if (timer) clearTimeout(timer);
  }
}
