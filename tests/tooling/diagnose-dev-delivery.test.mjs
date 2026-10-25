/** Read-only delivery diagnostics and safe-failure regressions.
 * @file
 */

import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { diagnoseDevDelivery } from "../../scripts/diagnose-dev-delivery.mjs";

const { Response } = globalThis;

it("never prints provider errors or credentials from the diagnostic CLI", () => {
  const module = new URL(
    "../../scripts/diagnose-dev-delivery.mjs",
    import.meta.url,
  );
  const source = `process.argv[1] = ${JSON.stringify(fileURLToPath(module))}; globalThis.fetch = async () => { throw new Error('private-provider-payload synthetic-secret'); }; await import(${JSON.stringify(module.href)});`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      env: fixture().env,
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("DIAGNOSTIC_REJECTED");
  expect(result.stdout + result.stderr).not.toMatch(
    /synthetic-secret|private-provider-payload/,
  );
});

/** Synthetic metadata; all requests are intercepted and unrecognized paths fail. */
function fixture() {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    EXPECTED_SOURCE_SHA: "a".repeat(40),
    DEPLOYMENT_ID: "dpl_test",
    VERCEL_ORG_ID: "team_test",
    VERCEL_PROJECT_ID: "prj_test",
    VERCEL_TOKEN: "synthetic-secret",
    TARGET_ORIGIN: "https://crypto-gateway-dev.vercel.app",
  };
  const project = {
    id: "prj_test",
    accountId: "team_test",
    name: "crypto-gateway-dev",
    targets: { production: { id: "dpl_test" } },
    ssoProtection: null,
  };
  const deployment = {
    id: "dpl_test",
    projectId: "prj_test",
    readyState: "READY",
    url: "immutable.vercel.app",
    meta: {
      sourceSha: env.EXPECTED_SOURCE_SHA,
      artifactDigest: "b".repeat(64),
    },
  };
  const fetcher = vi.fn(async (input, options) => {
    const url = new URL(input);
    expect(options.method).toBe("GET");
    if (url.hostname === "api.vercel.com") {
      expect(options.headers.authorization).toBe("Bearer synthetic-secret");
      expect(options.redirect).toBe("error");
      if (url.pathname === "/v9/projects/prj_test")
        return Response.json(project);
      expect(url.pathname).toBe("/v13/deployments/dpl_test");
      return Response.json(deployment);
    }
    expect(options.headers).toBeUndefined();
    expect(options.redirect).toBe("manual");
    if (url.hostname === "immutable.vercel.app")
      return new Response(null, { status: 401 });
    expect(url.hostname).toBe("crypto-gateway-dev.vercel.app");
    if (url.pathname === "/delivery.json")
      return Response.json({
        sourceSha: env.EXPECTED_SOURCE_SHA,
        environment: "dev",
        artifactDigest: "b".repeat(64),
      });
    if (url.pathname === "/api/demo/status")
      return Response.json({
        data: { enabled: false },
        privateField: "synthetic-secret",
      });
    return new Response(
      '<div id="root"></div><!-- private-provider-payload synthetic-secret -->',
    );
  });
  return { env, project, deployment, fetcher };
}

it("distinguishes protected immutable URLs from public stable URLs using reads and sanitized output", async () => {
  const f = fixture();
  const result = await diagnoseDevDelivery(f.env, f.fetcher);
  expect(f.fetcher).toHaveBeenCalledTimes(8);
  expect(result.ready).toBe(true);
  expect(
    result.checks.find(
      (check) => check.target === "stable" && check.path === "/",
    ).appShellMatched,
  ).toBe(true);
  expect(
    result.checks.find(
      (check) => check.target === "stable" && check.path === "/api/demo/status",
    ).statusShapeMatched,
  ).toBe(true);
  expect(result.protectionConfigurationPresent).toBe(false);
  expect(
    result.checks
      .filter((check) => check.target === "immutable")
      .every((check) => check.httpStatus === 401),
  ).toBe(true);
  expect(
    result.checks.find(
      (check) => check.path === "/delivery.json" && check.target === "stable",
    ).sourceArtifactMatched,
  ).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(
    /synthetic-secret|private-provider-payload/,
  );
});

it("rejects unsafe execution and untrusted URL/source/project metadata before application requests", async () => {
  for (const patch of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { EXPECTED_SOURCE_SHA: "main" },
    { DEPLOYMENT_ID: "../other" },
    { VERCEL_TOKEN: "" },
    { TARGET_ORIGIN: "https://other.invalid" },
  ]) {
    const f = fixture();
    await expect(
      diagnoseDevDelivery({ ...f.env, ...patch }, f.fetcher),
    ).rejects.toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  }
  for (const patch of [
    { projectId: "prj_other" },
    { url: "attacker.invalid" },
    { url: "immutable.vercel.app/redirect" },
    { meta: { sourceSha: "b".repeat(40) } },
  ]) {
    const f = fixture();
    Object.assign(f.deployment, patch);
    await expect(diagnoseDevDelivery(f.env, f.fetcher)).rejects.toThrow();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  }
});

it("rejects oversized metadata and never retries network failures", async () => {
  const f = fixture();
  const oversized = vi.fn(async () => new Response("x".repeat(65_537)));
  await expect(diagnoseDevDelivery(f.env, oversized)).rejects.toThrow();
  expect(oversized).toHaveBeenCalledTimes(1);
  const network = vi.fn(async () => {
    throw new Error("synthetic-secret");
  });
  await expect(diagnoseDevDelivery(f.env, network)).rejects.toThrow();
  expect(network).toHaveBeenCalledTimes(1);
});

it("retires the hosted diagnostic workflow entry point", () => {
  expect(() =>
    readFileSync(".github/workflows/diagnose-dev-delivery.yml"),
  ).toThrow(expect.objectContaining({ code: "ENOENT" }));
});
