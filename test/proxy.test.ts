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
import type { Server, IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { proxyHandler } from "../server/proxy";
import {
  DEV_FRONTEND,
  DEV_GATEWAY,
  gatewayAccessHeaders,
} from "../server/gateway";

let server: Server;
let port: number;
const id = "00000000-0000-4000-8000-000000000000";
const route = `/api/gateway/v1/checkout/${id}`;
const bearer = `Bearer ${"c".repeat(64)}`;
beforeAll(async () => {
  server = createServer((req, res) => {
    void proxyHandler(req, res);
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
  vi.stubEnv("GATEWAY_ORIGIN", DEV_GATEWAY);
  vi.stubEnv("DEMO_FRONTEND_ORIGIN", DEV_FRONTEND);
  vi.stubEnv("GATEWAY_ACCESS_CLIENT_ID", "fixture-runtime-id");
  vi.stubEnv("GATEWAY_ACCESS_CLIENT_SECRET", "fixture-runtime-secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function call(
  path = route,
  method = "GET",
  body = "",
  extra: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    raw: string;
    headers: IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          authorization: bearer,
          origin: DEV_FRONTEND,
          "content-type": "application/json",
          ...extra,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode!, raw, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

it.each(["", "/transactions", "/rpc"])(
  "preserves %s checkout operation and bearer without forwarding browser credentials",
  async (suffix) => {
    const raw =
      suffix === "/rpc"
        ? '{"jsonrpc":"2.0","id":1,"result":{"value":"fixture"}}'
        : '{"data":{"id":"fixture"}}';
    const fetcher = vi.fn(async (url, options: RequestInit) => {
      expect(url).toBe(`${DEV_GATEWAY}/v1/checkout/${id}${suffix}`);
      expect(options.method).toBe(suffix ? "POST" : "GET");
      expect(options.redirect).toBe("error");
      expect(options.signal).toBeInstanceOf(AbortSignal);
      expect(options.headers).toEqual({
        authorization: bearer,
        "CF-Access-Client-Id": "fixture-runtime-id",
        "CF-Access-Client-Secret": "fixture-runtime-secret",
        ...(suffix
          ? {
              "content-type": "application/json",
              "solana-client": "fixture-client",
            }
          : {}),
      });
      if (suffix)
        expect(Buffer.from(options.body as Uint8Array).toString()).toBe(
          '{ "signature": "fixture" }',
        );
      return new Response(raw, {
        headers: {
          "content-type": "application/json",
          "x-request-id": "fixture-request",
          "retry-after": "2",
          "set-cookie": "CF_Authorization=secret",
          location: "https://other.example",
          "cf-access-jwt-assertion": "secret",
        },
      });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await call(
      `${route}${suffix}`,
      suffix ? "POST" : "GET",
      suffix ? '{ "signature": "fixture" }' : "",
      {
        cookie: "owner-session",
        "x-vercel-protection-bypass": "fixture-bypass",
        "x-forwarded-for": "1.2.3.4",
        "solana-client": "fixture-client",
      },
    );
    expect(result.status).toBe(200);
    expect(result.raw).toBe(raw);
    expect(result.headers["x-request-id"]).toBe("fixture-request");
    expect(result.headers["retry-after"]).toBe("2");
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["set-cookie"]).toBeUndefined();
    expect(result.headers.location).toBeUndefined();
    expect(result.raw).not.toContain("fixture-runtime");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("rejects routes, methods, origins and credential overrides before network access", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const path of [
    "/api/gateway/v1/payments",
    `${route}?url=https://evil.example`,
    `${route}/../rpc`,
    `${route}/%2e%2e`,
    `${route}/rpc/extra`,
    route.replace(id, "%30" + id.slice(1)),
  ])
    expect((await call(path)).status).toBe(404);
  expect((await call(route, "DELETE")).status).toBe(405);
  expect((await call(`${route}/rpc`, "GET")).status).toBe(405);
  expect(
    (await call(route, "GET", "", { origin: "https://evil.example" })).status,
  ).toBe(403);
  expect(
    (await call(`${route}/rpc`, "POST", "{}", { origin: "" })).status,
  ).toBe(403);
  expect(
    (await call(route, "GET", "", { authorization: "invalid" })).status,
  ).toBe(401);
  expect(
    (await call(route, "GET", "", { "cf-access-client-secret": "attacker" }))
      .status,
  ).toBe(400);
  expect(
    (await call(`${route}/rpc`, "POST", "{}", { "content-type": "text/plain" }))
      .status,
  ).toBe(415);
  expect(
    (
      await call(
        `${route}/rpc`,
        "POST",
        JSON.stringify({ large: "x".repeat(4096) }),
      )
    ).status,
  ).toBe(413);
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires complete private dev configuration and rejects dev credentials on production/local targets", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  for (const [key, value] of [
    ["GATEWAY_ORIGIN", "https://evil.example"],
    ["GATEWAY_ACCESS_CLIENT_ID", ""],
    ["GATEWAY_ACCESS_CLIENT_SECRET", ""],
    ["DEMO_FRONTEND_ORIGIN", "https://production.example"],
  ]) {
    const previous = process.env[key]!;
    vi.stubEnv(key, value);
    expect((await call()).status).toBe(503);
    vi.stubEnv(key, previous);
  }
  expect(() => gatewayAccessHeaders("https://production.example")).toThrow();
  expect(() => gatewayAccessHeaders("http://localhost:8787")).toThrow();
  vi.stubEnv("GATEWAY_ACCESS_CLIENT_ID", "");
  vi.stubEnv("GATEWAY_ACCESS_CLIENT_SECRET", "");
  expect(gatewayAccessHeaders("https://production.example")).toEqual({});
  expect(gatewayAccessHeaders("http://localhost:8787")).toEqual({});
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(["html", "redirect", "access-json", "oversize", "network"])(
  "fails closed on %s with no retry or upstream leakage",
  async (kind) => {
    const fetcher = vi.fn(async () => {
      if (kind === "network") throw new Error("fixture-runtime-secret");
      if (kind === "html")
        return new Response("login fixture-runtime-secret", {
          headers: { "content-type": "text/html" },
        });
      if (kind === "redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "https://login.example" },
        });
      if (kind === "oversize")
        return Response.json({ data: "x".repeat(65_536) });
      return Response.json({ error: "access denied" }, { status: 403 });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await call();
    expect([502, 503]).toContain(result.status);
    expect(result.raw).toContain("UPSTREAM_UNAVAILABLE");
    expect(result.raw).not.toContain("fixture-runtime");
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("preserves typed disabled/429 errors and never retries an uncertain signature submission", async () => {
  for (const [status, code] of [
    [503, "PAYMENTS_DISABLED"],
    [429, "RATE_LIMITED"],
  ] as const) {
    const fetcher = vi.fn(async () =>
      Response.json({ error: { code, message: "fixture" } }, { status }),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await call(
      `${route}/transactions`,
      "POST",
      '{"signature":"fixture"}',
    );
    expect(result.status).toBe(status);
    expect(JSON.parse(result.raw).error.code).toBe(code);
    expect(fetcher).toHaveBeenCalledOnce();
  }
});

it("propagates the upstream deadline without retry or secret-bearing errors", async () => {
  const deadline = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const fetcher = vi.fn(
    (_url, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        options.signal!.addEventListener(
          "abort",
          () => reject(new Error("fixture-runtime-secret")),
          { once: true },
        );
        started();
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const pending = call();
  await ready;
  deadline.abort();
  const result = await pending;
  expect(result.status).toBe(503);
  expect(result.raw).not.toContain("fixture-runtime-secret");
  expect(fetcher).toHaveBeenCalledOnce();
});
