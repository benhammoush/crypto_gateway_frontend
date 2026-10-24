import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import { createServer, request } from "node:http";
import type { IncomingHttpHeaders, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { merchantHandler } from "../../server/merchant";

let server: Server;
let port: number;
beforeAll(async () => {
  server = createServer((req, res) => {
    void merchantHandler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  vi.stubEnv("DEMO_ENABLED", "true");
  vi.stubEnv("DEMO_FRONTEND_ORIGIN", "http://localhost:5173");
  vi.stubEnv("GATEWAY_ORIGIN", "http://localhost:8787");
  vi.stubEnv("DEMO_MERCHANT_API_KEY", "fixture_merchant_credential_1234567890");
  vi.stubEnv("DEMO_WEBHOOK_SECRET", "fixture_webhook_secret_123456789012345");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function call(
  path: string,
  body: string,
  headers: Record<string, string> = {},
  method = "POST",
) {
  return new Promise<{
    status: number;
    body: string;
    headers: IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          origin: "http://localhost:5173",
          "idempotency-key": "fixture_key_1234",
          ...headers,
        },
      },
      (res) => {
        let result = "";
        res.on("data", (data) => {
          result += data;
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            body: result,
            headers: res.headers,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

it("reports only a non-cacheable demo flag without credentials or upstream requests", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  for (const flag of ["true", "false", "", "TRUE"]) {
    vi.stubEnv("DEMO_ENABLED", flag);
    const result = await call("/api/demo/status", "", {}, "GET");
    expect(result.status).toBe(200);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(result.body)).toEqual({
      data: { enabled: flag === "true" },
    });
    expect(result.body).not.toContain("fixture_merchant");
    expect(result.body).not.toContain("fixture_webhook");
  }
  expect((await call("/api/demo/status", "{}")).status).toBe(405);
  expect(upstream).not.toHaveBeenCalled();
});

it("keeps the payment guard authoritative after an earlier enabled status response", async () => {
  const upstream = vi.fn();
  vi.stubGlobal("fetch", upstream);
  expect(
    JSON.parse((await call("/api/demo/status", "", {}, "GET")).body),
  ).toEqual({ data: { enabled: true } });
  vi.stubEnv("DEMO_ENABLED", "false");
  expect((await call("/api/demo/payments", '{"usdCents":100}')).status).toBe(
    503,
  );
  expect(upstream).not.toHaveBeenCalled();
});

it("creates payments server-side without returning the merchant credential", async () => {
  const upstream = vi.fn(async (_url: string, options: RequestInit) => {
    expect(JSON.parse(String(options.body))).toEqual({
      usdCents: 1234,
      merchantReference: "demo:fixture_key_1234",
    });
    expect((options.headers as Record<string, string>).authorization).toContain(
      "fixture_merchant_credential",
    );
    return Response.json({
      data: {
        checkoutUrl: `http://localhost:5173/checkout/payment#${"a".repeat(64)}`,
      },
    });
  });
  vi.stubGlobal("fetch", upstream);
  const result = await call("/api/demo/payments", '{"usdCents":1234}');
  expect(result.status).toBe(200);
  expect(upstream).toHaveBeenCalledOnce();
  expect(result.body).not.toContain("fixture_merchant_credential");
});

it.each([
  ["UNAUTHORIZED", 401],
  ["NOT_CONFIGURED", 503],
  ["PAYMENTS_DISABLED", 503],
  ["ORIGIN_REJECTED", 403],
  ["RATE_LIMITED", 429],
  ["INVALID_REQUEST", 400],
  ["INVALID_IDEMPOTENCY_KEY", 400],
  ["IDEMPOTENCY_CONFLICT", 409],
  ["PRICE_UNAVAILABLE", 503],
  ["RPC_UNAVAILABLE", 503],
  ["WRONG_NETWORK", 503],
  ["INTERNAL_ERROR", 500],
])(
  "reports only the allowlisted %s code and UUID request ID",
  async (code, status) => {
    const requestId = "22222222-2222-4222-8222-222222222222";
    const upstream = vi.fn(async () =>
      Response.json(
        {
          error: {
            code,
            requestId,
            message:
              "private-provider-message-with-fixture_merchant_credential",
            url: "https://provider.example/?key=private-provider-key",
          },
        },
        { status },
      ),
    );
    vi.stubGlobal("fetch", upstream);
    const result = await call("/api/demo/payments", '{"usdCents":100}');
    expect(result.status).toBe(status === 429 ? 429 : 503);
    expect(JSON.parse(result.body)).toEqual({
      error: {
        code: "DEMO_ERROR",
        message: `Unable to create payment. Retry with the same amount. Diagnostic: ${code}. Request ID: ${requestId}.`,
      },
    });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(upstream).toHaveBeenCalledOnce();
  },
);

it.each([
  undefined,
  null,
  123,
  {},
  "private-request-id",
  "22222222-2222-4222-8222-222222222222\n",
  "22222222-2222-4222-8222-222222222222?key=private-provider-key",
])(
  "omits a malformed request ID %j without losing a safe error code",
  async (requestId) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: { code: "PRICE_UNAVAILABLE", requestId },
          },
          { status: 503 },
        ),
      ),
    );
    const result = await call("/api/demo/payments", '{"usdCents":100}');
    expect(JSON.parse(result.body).error.message).toBe(
      "Unable to create payment. Retry with the same amount. Diagnostic: PRICE_UNAVAILABLE.",
    );
  },
);

it.each([
  null,
  [],
  "private-provider-payload",
  {},
  { error: null },
  { error: { code: "private-provider-error" } },
  { error: { code: { nested: "private-provider-error" } } },
  { error: { code: "UNAUTHORIZED\nprivate-provider-error" } },
  {
    error: {
      code: "UNKNOWN",
      requestId: "22222222-2222-4222-8222-222222222222",
    },
  },
])(
  "keeps the generic fallback for malformed or unrecognized upstream JSON %j",
  async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(body, { status: 503 })),
    );
    const result = await call("/api/demo/payments", '{"usdCents":100}');
    expect(result.status).toBe(503);
    expect(JSON.parse(result.body)).toEqual({
      error: {
        code: "DEMO_ERROR",
        message: "Unable to create payment. Retry with the same amount.",
      },
    });
  },
);

it("does not trust error diagnostics inside a successful upstream response", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        error: {
          code: "UNAUTHORIZED",
          requestId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    ),
  );
  const result = await call("/api/demo/payments", '{"usdCents":100}');
  expect(JSON.parse(result.body).error.message).toBe(
    "Unable to create payment. Retry with the same amount.",
  );
});

it.each(["non-JSON response", "network exception"])(
  "does not leak a %s or automatically retry",
  async (failure) => {
    const upstream = vi.fn(async () => {
      if (failure === "network exception")
        throw new Error("private-network-url-and-credential");
      return new Response("private-provider-payload", { status: 502 });
    });
    vi.stubGlobal("fetch", upstream);
    const result = await call("/api/demo/payments", '{"usdCents":100}');
    expect(result.status).toBe(503);
    expect(JSON.parse(result.body)).toEqual({
      error: {
        code: "DEMO_ERROR",
        message: "The example service is temporarily unavailable.",
      },
    });
    expect(upstream).toHaveBeenCalledOnce();
  },
);

it("rejects cross-origin requests, browser overrides and disabled configuration", async () => {
  expect(
    (
      await call("/api/demo/payments", '{"usdCents":100}', {
        origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call(
        "/api/demo/payments",
        '{"usdCents":100,"recipient":"override"}',
      )
    ).status,
  ).toBe(400);
  vi.stubEnv("DEMO_ENABLED", "false");
  expect((await call("/api/demo/payments", '{"usdCents":100}')).status).toBe(
    503,
  );
});

it("verifies raw webhook bytes and timestamp and acknowledges duplicates", async () => {
  const raw = '{ "id": "evt_fixture", "type": "payment.settled" }';
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", process.env.DEMO_WEBHOOK_SECRET!)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const headers = {
    "crypto-gateway-signature": `t=${timestamp},v1=${signature}`,
  };
  expect((await call("/api/demo/webhook", raw, headers)).status).toBe(200);
  expect((await call("/api/demo/webhook", raw, headers)).body).toContain(
    '"duplicate":true',
  );
  expect(
    (await call("/api/demo/webhook", JSON.stringify(JSON.parse(raw)), headers))
      .status,
  ).toBe(401);
  expect(
    (
      await call("/api/demo/webhook", raw, {
        "crypto-gateway-signature": `t=1,v1=${signature}`,
      })
    ).status,
  ).toBe(401);
});
