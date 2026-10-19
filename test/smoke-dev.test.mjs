import { expect, it } from "vitest";
import { privateDevConfig, smokeDev } from "../scripts/smoke-dev.mjs";
const { Response } = globalThis;

const env = {
  DELIVERY_TARGET: "dev",
  TARGET_ORIGIN: "https://crypto-gateway-dev.vercel.app",
  VERCEL_PROJECT_ID: "prj_FFmiI0JcXuVhow1RzC3ecurNeX07",
  VERCEL_ORG_ID: "team_WmXGY6jB1bmGyOzq1wxJBnE0",
  SOURCE_SHA: "a".repeat(40),
  VERCEL_TOKEN: "fixture-provider",
  VERCEL_DEV_SMOKE_BYPASS: "fixture-bypass",
  DEPLOYMENT_URL: "https://crypto-gateway-dev-fixture-team.vercel.app",
};
function fixture(kind) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    if (url.startsWith("https://api.vercel.com/")) {
      expect(options.headers).toEqual({
        authorization: "Bearer fixture-provider",
      });
      if (url.includes("/deployments/"))
        return Response.json({
          id: "dpl_fixture",
          projectId: env.VERCEL_PROJECT_ID,
          readyState: "READY",
          url: new URL(env.DEPLOYMENT_URL).hostname,
          meta: {
            githubCommitSha:
              kind === "source" ? "b".repeat(40) : env.SOURCE_SHA,
          },
          alias: [new URL(env.TARGET_ORIGIN).hostname],
        });
      return Response.json({
        id: env.VERCEL_PROJECT_ID,
        accountId: env.VERCEL_ORG_ID,
        targets: {
          production: { id: kind === "alias" ? "dpl_other" : "dpl_fixture" },
        },
      });
    }
    expect([new URL(env.DEPLOYMENT_URL).origin, env.TARGET_ORIGIN]).toContain(
      new URL(url).origin,
    );
    expect(options.headers["x-vercel-protection-bypass"]).toBe(
      "fixture-bypass",
    );
    expect(options.headers.authorization).not.toBe("Bearer fixture-provider");
    if (kind === "network") throw new Error("fixture-bypass");
    if (kind === "redirect") return new Response(null, { status: 302 });
    if (url.endsWith("/"))
      return new Response(
        kind === "login"
          ? "<title>Login</title>"
          : "<title>crypto_gateway</title>",
        { headers: { "content-type": "text/html" } },
      );
    if (url.endsWith("/api/demo/status"))
      return Response.json({ data: { enabled: kind === "enabled" } });
    return Response.json(
      {
        error: {
          code: kind === "access" ? "ACCESS_DENIED" : "PAYMENTS_DISABLED",
        },
      },
      { status: 503 },
    );
  };
  return { calls, fetcher };
}
it("checks exact source, stable alias, functions and immutable deployment with scoped credentials", async () => {
  const f = fixture();
  expect(await smokeDev(env, f.fetcher)).toEqual({
    privateDevSmokeVerified: true,
    deployment: "dpl_fixture",
    source: env.SOURCE_SHA,
  });
  expect(f.calls).toHaveLength(8);
  expect(f.calls.every(({ url }) => !url.includes("/api/demo/payments"))).toBe(
    true,
  );
});
it.each([
  "source",
  "alias",
  "login",
  "enabled",
  "access",
  "redirect",
  "network",
])("rejects %s without retry", async (kind) => {
  const f = fixture(kind);
  await expect(smokeDev(env, f.fetcher)).rejects.toThrow();
  expect(new Set(f.calls.map(({ url }) => url)).size).toBe(f.calls.length);
});
it.each([
  { DELIVERY_TARGET: "production" },
  { TARGET_ORIGIN: "https://evil.example" },
  { VERCEL_PROJECT_ID: "prj_other" },
  { VERCEL_DEV_SMOKE_BYPASS: "" },
  { VERCEL_TOKEN: "" },
])("rejects invalid preflight %j before mutation", (extra) => {
  expect(() => privateDevConfig({ ...env, ...extra })).toThrow();
});
it("does not send credentials to an unapproved deployment host", async () => {
  const f = fixture();
  await expect(
    smokeDev({ ...env, DEPLOYMENT_URL: "https://evil.example" }, f.fetcher),
  ).rejects.toThrow();
  expect(f.calls).toHaveLength(0);
});
