import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyDev } from "../scripts/verify-dev.mjs";
const { Response, AbortSignal } = globalThis;
afterEach(() => vi.restoreAllMocks());

/** Synthetic configuration; no provider credentials or calls. */
function environment() {
  return {
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: "a".repeat(40),
    DEPLOY_ENABLED: "false",
    DEMO_ENABLED: "false",
    VERCEL_ORG_ID: "team_test",
    VERCEL_PROJECT_ID: "prj_dev",
    VERCEL_TOKEN: "synthetic-secret",
  };
}

/** Return metadata for the exact fixture project, with no provider access. */
function project() {
  return { id: "prj_dev", accountId: "team_test", name: "crypto-gateway-dev" };
}

it("reads only the exact dev project and emits no provider payload or secret", async () => {
  const env = environment();
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const fetcher = vi.fn(async (url, init) => {
    expect(url).toBe(
      "https://api.vercel.com/v9/projects/prj_dev?teamId=team_test",
    );
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.authorization).toBe(`Bearer ${env.VERCEL_TOKEN}`);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    return Response.json({
      ...project(),
      privateProviderField: "do not print",
    });
  });
  expect(await verifyDev(env, fetcher)).toEqual({
    sourceSha: env.GITHUB_SHA,
    projectIdentityMatched: true,
    repositoryLinkAbsent: true,
    deploymentTargetObserved: false,
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(timeout).toHaveBeenCalledWith(15_000);
});

it("cancels oversized response streams", async () => {
  let cancelled = false;
  const stream = new globalThis.ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(65_537));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(
    verifyDev(
      environment(),
      vi.fn(async () => new Response(stream)),
    ),
  ).rejects.toThrow("PROJECT_METADATA_RESPONSE_TOO_LARGE");
  expect(cancelled).toBe(true);
});

it("never prints network errors or secrets from the CLI", () => {
  const module = new URL("../scripts/verify-dev.mjs", import.meta.url);
  const source = `process.argv[1] = ${JSON.stringify(fileURLToPath(module))}; globalThis.fetch = async () => { throw new Error('private-provider-payload synthetic-secret'); }; await import(${JSON.stringify(module.href)});`;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    { env: environment(), encoding: "utf8" },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("VERIFICATION_FAILED");
  expect(result.stdout + result.stderr).not.toMatch(
    /private-provider-payload|synthetic-secret/,
  );
});

it("rejects nonmanual/nonmain, activation and malformed identities before network access", async () => {
  for (const [key, value] of [
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["GITHUB_SHA", "main"],
    ["DEPLOY_ENABLED", "true"],
    ["DEMO_ENABLED", "true"],
    ["VERCEL_ORG_ID", "../production"],
    ["VERCEL_PROJECT_ID", "../production"],
    ["VERCEL_TOKEN", ""],
  ]) {
    const fetcher = vi.fn();
    await expect(
      verifyDev({ ...environment(), [key]: value }, fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  }
});

it("rejects account/project mismatches, Git linkage and malformed deployment targets", async () => {
  for (const body of [
    null,
    { ...project(), id: "prj_other" },
    { ...project(), accountId: "team_other" },
    { ...project(), name: "crypto-gateway-production" },
    { ...project(), link: { repo: "competing-writer" } },
    { ...project(), targets: { production: {} } },
    { ...project(), targets: { production: { id: ["dpl_array"] } } },
  ]) {
    await expect(
      verifyDev(
        environment(),
        vi.fn(async () => Response.json(body)),
      ),
    ).rejects.toThrow();
  }
  expect(
    await verifyDev(
      environment(),
      vi.fn(async () =>
        Response.json({
          ...project(),
          targets: { production: { id: "dpl_previous" } },
        }),
      ),
    ),
  ).toHaveProperty("deploymentTargetObserved", true);
});

it.each([401, 403, 404, 429, 500])(
  "rejects HTTP %s without retrying or reflecting provider errors",
  async (status) => {
    const fetcher = vi.fn(
      async () => new Response("private provider payload", { status }),
    );
    await expect(verifyDev(environment(), fetcher)).rejects.toThrow(
      `PROJECT_METADATA_HTTP_${status}`,
    );
    expect(fetcher).toHaveBeenCalledOnce();
  },
);

it("rejects oversized and malformed metadata", async () => {
  for (const response of [
    new Response("x".repeat(65_537)),
    new Response("not-json"),
  ]) {
    await expect(
      verifyDev(
        environment(),
        vi.fn(async () => response),
      ),
    ).rejects.toThrow();
  }
});

it("uses a manual main-only dev job without deployment tracking or credential-bearing install", () => {
  const workflow = readFileSync(".github/workflows/verify-dev.yml", "utf8");
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain("name: dev\n      deployment: false");
  expect(workflow).toContain("persist-credentials: false");
  expect(workflow).toContain("contents: read");
  expect(workflow).not.toMatch(
    /npm ci|vercel@|production|workflow_call|pull_request|push:/,
  );
});
