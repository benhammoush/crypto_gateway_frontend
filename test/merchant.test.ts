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
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHmac } from "node:crypto";
import { merchantHandler } from "../server/merchant";

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
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
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
        res.on("end", () => resolve({ status: res.statusCode!, body: result }));
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

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
