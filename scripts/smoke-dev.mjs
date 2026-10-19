/** Private dev read-only smoke. No payments, redirects, retries or secret output. @file */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

const origin = "https://crypto-gateway-dev.vercel.app";
const projectId = "prj_FFmiI0JcXuVhow1RzC3ecurNeX07";
const teamId = "team_WmXGY6jB1bmGyOzq1wxJBnE0";

/** Reject incomplete configuration before a deployment mutation. */
export function privateDevConfig(env) {
  assert.equal(env.DELIVERY_TARGET, "dev");
  assert.equal(env.TARGET_ORIGIN, origin);
  assert.equal(env.VERCEL_PROJECT_ID, projectId);
  assert.equal(env.VERCEL_ORG_ID, teamId);
  assert.match(env.SOURCE_SHA ?? "", /^[a-f0-9]{40}$/);
  for (const key of ["VERCEL_TOKEN", "VERCEL_DEV_SMOKE_BYPASS"])
    assert.ok(
      env[key] && !/[^\x21-\x7e]/.test(env[key]),
      "Missing smoke credential.",
    );
}

/** Bound streamed responses as well as the fetch duration. */
async function text(response) {
  const reader = response.body?.getReader();
  assert.ok(reader, "Empty smoke response.");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= 65_536, "Smoke response too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Associate both smoke hosts with the exact selected project/deployment/source. */
export async function smokeDev(env, fetcher = globalThis.fetch) {
  privateDevConfig(env);
  const deployed = new URL(env.DEPLOYMENT_URL);
  assert.equal(deployed.origin, env.DEPLOYMENT_URL);
  assert.equal(deployed.protocol, "https:");
  assert.match(
    deployed.hostname,
    /^crypto-gateway-dev-[a-z0-9-]+\.vercel\.app$/,
  );
  const options = (headers) => ({
    method: "GET",
    headers,
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const provider = async (path) => {
    const response = await fetcher(
      `https://api.vercel.com${path}`,
      options({ authorization: `Bearer ${env.VERCEL_TOKEN}` }),
    );
    assert.equal(response.status, 200);
    return JSON.parse(await text(response));
  };
  const deployment = await provider(
    `/v13/deployments/${deployed.hostname}?teamId=${teamId}`,
  );
  assert.equal(deployment.projectId, projectId);
  assert.equal(deployment.readyState, "READY");
  assert.equal(deployment.url, deployed.hostname);
  assert.equal(deployment.meta?.githubCommitSha, env.SOURCE_SHA);
  const project = await provider(`/v9/projects/${projectId}?teamId=${teamId}`);
  assert.equal(project.id, projectId);
  assert.equal(project.accountId, teamId);
  assert.equal(project.targets?.production?.id, deployment.id);
  assert.ok(
    deployment.alias?.includes(new URL(origin).hostname),
    "Stable dev alias not assigned.",
  );
  for (const host of [origin, deployed.origin]) {
    for (const path of [
      "/",
      "/api/demo/status",
      "/api/gateway/v1/checkout/00000000-0000-4000-8000-000000000000",
    ]) {
      const headers = {
        "x-vercel-protection-bypass": env.VERCEL_DEV_SMOKE_BYPASS,
      };
      if (path.includes("/api/gateway/"))
        headers.authorization = `Bearer ${"0".repeat(64)}`;
      const response = await fetcher(`${host}${path}`, options(headers));
      const raw = await text(response);
      if (path === "/") {
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") ?? "", /text\/html/);
        assert.match(raw, /<title>crypto_gateway<\/title>/);
      } else {
        assert.match(
          response.headers.get("content-type") ?? "",
          /^application\/json/,
        );
        const body = JSON.parse(raw);
        if (path === "/api/demo/status") {
          assert.equal(response.status, 200);
          assert.deepEqual(body, { data: { enabled: false } });
        } else {
          assert.equal(response.status, 503);
          assert.equal(body.error?.code, "PAYMENTS_DISABLED");
        }
      }
    }
  }
  return {
    privateDevSmokeVerified: true,
    deployment: deployment.id,
    source: env.SOURCE_SHA,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    if (process.argv[2] === "--preflight") privateDevConfig(process.env);
    else
      process.stdout.write(`${JSON.stringify(await smokeDev(process.env))}\n`);
  } catch {
    process.stderr.write(
      "Private dev smoke not verified; inspect without redeploying or enabling payments.\n",
    );
    process.exitCode = 1;
  }
}
