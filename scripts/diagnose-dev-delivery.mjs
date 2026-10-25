/** Inspect one recorded dev deployment with bounded reads; never deploy or expose provider bodies.
 * @file
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Controlled read-only diagnostic failure without raw provider details. */
class DiagnosticError extends Error {}

/** Read bounded text, cancelling unread data without reflecting its contents.
 * @param response - Selected metadata or public application response.
 * @returns At most 64 KiB of response text; rejects oversized bodies.
 */
async function text(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= 65_536);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Read fixed Vercel metadata and unauthenticated application endpoints for the configured dev project only.
 * @param env - Explicit dev identities and diagnostic execution context.
 * @param fetcher - Injectable read-only transport.
 * @returns Sanitized identity and endpoint observations, not acceptance evidence.
 */
export async function diagnoseDevDelivery(env, fetcher = globalThis.fetch) {
  assert.equal(env.GITHUB_ACTIONS, "true");
  assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(env.GITHUB_REF, "refs/heads/main");
  assert.match(env.EXPECTED_SOURCE_SHA ?? "", /^[a-f0-9]{40}$/);
  assert.match(env.DEPLOYMENT_ID ?? "", /^dpl_[a-zA-Z0-9]+$/);
  assert.match(env.VERCEL_ORG_ID ?? "", /^team_[a-zA-Z0-9]+$/);
  assert.match(env.VERCEL_PROJECT_ID ?? "", /^prj_[a-zA-Z0-9]+$/);
  assert.ok(env.VERCEL_TOKEN);
  assert.equal(env.TARGET_ORIGIN, "https://crypto-gateway-dev.vercel.app");

  /** Never send the provider credential outside its fixed API origin.
   * @param path - Fixed project or deployment metadata path.
   * @returns Parsed metadata, rejecting failed or oversized responses.
   */
  async function metadata(path) {
    const response = await fetcher(
      `https://api.vercel.com${path}?teamId=${env.VERCEL_ORG_ID}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${env.VERCEL_TOKEN}` },
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DiagnosticError(`METADATA_HTTP_${response.status}`);
    }
    return JSON.parse(await text(response));
  }
  const project = await metadata(`/v9/projects/${env.VERCEL_PROJECT_ID}`);
  assert.equal(project.id, env.VERCEL_PROJECT_ID);
  assert.equal(project.accountId, env.VERCEL_ORG_ID);
  assert.equal(project.name, "crypto-gateway-dev");
  const deployment = await metadata(`/v13/deployments/${env.DEPLOYMENT_ID}`);
  assert.equal(deployment.id, env.DEPLOYMENT_ID);
  assert.equal(deployment.projectId, project.id);
  assert.equal(deployment.meta?.sourceSha, env.EXPECTED_SOURCE_SHA);
  assert.match(deployment.meta?.artifactDigest ?? "", /^[a-f0-9]{64}$/);
  assert.match(deployment.url ?? "", /^[a-z0-9-]+\.vercel\.app$/);
  const checks = [];
  for (const [target, origin] of [
    ["immutable", `https://${deployment.url}`],
    ["stable", env.TARGET_ORIGIN],
  ]) {
    for (const path of ["/", "/delivery.json", "/api/demo/status"]) {
      const check = { target, path, httpStatus: null };
      try {
        const response = await fetcher(`${origin}${path}`, {
          method: "GET",
          redirect: "manual",
          signal: globalThis.AbortSignal.timeout(15_000),
        });
        check.httpStatus = response.status;
        if (response.status === 200) {
          const body = await text(response);
          if (path === "/")
            check.appShellMatched = body.includes('<div id="root">');
          else {
            const value = JSON.parse(body);
            if (path === "/delivery.json")
              check.sourceArtifactMatched =
                value.sourceSha === env.EXPECTED_SOURCE_SHA &&
                value.environment === "dev" &&
                value.artifactDigest === deployment.meta.artifactDigest;
            else
              check.statusShapeMatched =
                typeof value.data?.enabled === "boolean" &&
                Object.keys(value.data).length === 1;
          }
        } else await response.body?.cancel();
      } catch {
        check.readFailed = true;
      }
      checks.push(check);
    }
  }
  return {
    sourceSha: env.EXPECTED_SOURCE_SHA,
    deploymentId: env.DEPLOYMENT_ID,
    ready: deployment.readyState === "READY",
    selectedDeploymentIsCurrent:
      project.targets?.production?.id === deployment.id,
    protectionConfigurationPresent:
      project.ssoProtection != null || project.passwordProtection != null,
    checks,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const result = await diagnoseDevDelivery(process.env);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Read-only dev delivery diagnostic\n\n${JSON.stringify(result, null, 2)}\n\nNo deployment, configuration change or authenticated application request was made. This report is not delivery or user acceptance.\n`,
    );
  } catch (error) {
    const code =
      error instanceof DiagnosticError ? error.message : "DIAGNOSTIC_REJECTED";
    process.stderr.write(
      `Read-only diagnostic stopped: ${code}; no provider mutation was requested.\n`,
    );
    process.exitCode = 1;
  }
}
