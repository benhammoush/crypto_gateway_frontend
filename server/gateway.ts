/** Server-only transport for the isolated private dev Worker. Never import in src. */
export const DEV_GATEWAY = "https://crypto-gateway-dev.benhxm.workers.dev";
export const DEV_FRONTEND = "https://crypto-gateway-dev.vercel.app";

/** Keep Access credentials independent of merchant/checkout Authorization. */
export function gatewayAccessHeaders(origin: string): Record<string, string> {
  const id = process.env.GATEWAY_ACCESS_CLIENT_ID;
  const secret = process.env.GATEWAY_ACCESS_CLIENT_SECRET;
  if (origin !== DEV_GATEWAY) {
    if (id || secret) throw new Error("Dev credentials on a non-dev target.");
    return {};
  }
  if (
    process.env.DEMO_FRONTEND_ORIGIN !== DEV_FRONTEND ||
    !id ||
    !secret ||
    /[^\x21-\x7e]/.test(id + secret)
  )
    throw new Error("Private dev configuration is incomplete.");
  return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
}

/** Bound even chunked upstream JSON; reject HTML/login responses and redirects. */
export async function gatewayJson(response: Response): Promise<{
  raw: Buffer;
  body: Record<string, unknown>;
}> {
  if (
    response.status < 200 ||
    (response.status >= 300 && response.status < 400) ||
    !/^application\/json(?:\s*;|$)/i.test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    await response.body?.cancel();
    throw new Error("Unexpected gateway response.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty gateway response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65_536) throw new Error("Gateway response too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = Buffer.concat(chunks);
  const body: unknown = JSON.parse(raw.toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Unexpected gateway JSON.");
  return { raw, body: body as Record<string, unknown> };
}
