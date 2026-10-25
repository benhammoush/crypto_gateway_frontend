/**
 * Read only the configured dev project's metadata; never deploy or certify readiness.
 * @file
 */
import { appendFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { pathToFileURL } from "node:url";

/** Controlled dev-verification failure without credential-bearing provider details. */
class VerificationError extends Error {}

/** Fail with a source-defined classification, never a provider response.
 * @param condition - Identity or execution guard that must hold.
 * @param code - Controlled failure classification safe for logs.
 */
function requireValue(condition, code) {
  if (!condition) throw new VerificationError(code);
}

/** Read a bounded JSON response without redirects, retries or payload logging.
 * @param fetcher - Injectable read-only transport.
 * @param url - Fixed Vercel metadata endpoint for the selected dev project.
 * @param token - Provider credential retained only in the authorization header.
 * @returns Parsed metadata, rejecting failed or oversized responses.
 */
async function readMetadata(fetcher, url, token) {
  const response = await fetcher(url, {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new VerificationError(`PROJECT_METADATA_HTTP_${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValue(size <= 65_536, "PROJECT_METADATA_RESPONSE_TOO_LARGE");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Inspect only the exact configured dev project, never other projects or runtime secrets.
 * @param env - Dev project identities and manual-main execution context.
 * @param fetcher - Injectable read-only transport.
 * @returns Sanitized identity observations, not deployment certification.
 */
export async function verifyDev(env, fetcher = globalThis.fetch) {
  requireValue(
    env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      env.GITHUB_REF === "refs/heads/main" &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? ""),
    "MANUAL_MAIN_REQUIRED",
  );
  requireValue(
    !env.DEPLOY_ENABLED || env.DEPLOY_ENABLED === "false",
    "DEPLOYMENT_MUST_REMAIN_DISABLED",
  );
  requireValue(
    !env.DEMO_ENABLED || env.DEMO_ENABLED === "false",
    "DEMO_MUST_REMAIN_DISABLED",
  );
  requireValue(
    /^team_[a-zA-Z0-9]+$/.test(env.VERCEL_ORG_ID ?? "") &&
      /^prj_[a-zA-Z0-9]+$/.test(env.VERCEL_PROJECT_ID ?? "") &&
      Boolean(env.VERCEL_TOKEN),
    "DEV_CONFIGURATION_MISSING_OR_INVALID",
  );
  const project = await readMetadata(
    fetcher,
    `https://api.vercel.com/v9/projects/${env.VERCEL_PROJECT_ID}?teamId=${env.VERCEL_ORG_ID}`,
    env.VERCEL_TOKEN,
  );
  requireValue(
    project?.id === env.VERCEL_PROJECT_ID &&
      project.accountId === env.VERCEL_ORG_ID &&
      project.name === "crypto-gateway-dev",
    "PROJECT_IDENTITY_MISMATCH",
  );
  requireValue(!project.link, "COMPETING_GIT_LINK_PRESENT");
  const target = project.targets?.production;
  requireValue(
    target == null ||
      (typeof target.id === "string" && /^dpl_[a-zA-Z0-9]+$/.test(target.id)),
    "PROJECT_TARGET_IDENTITY_INVALID",
  );
  return {
    sourceSha: env.GITHUB_SHA,
    projectIdentityMatched: true,
    repositoryLinkAbsent: true,
    deploymentTargetObserved: target != null,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const result = await verifyDev(process.env);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Read-only dev metadata\n\n${JSON.stringify(result)}\n\nOnly selected metadata reads succeeded. Token least-privilege scope, runtime secrets, other deployment writers, hosted payments and recovery eligibility are not certified. An absent target is not proof of empty deployment history. No deployment was requested.\n`,
    );
  } catch (error) {
    const code =
      error instanceof VerificationError
        ? error.message
        : "VERIFICATION_FAILED";
    process.stderr.write(
      `Read-only dev verification rejected: ${code}. No provider changes were requested.\n`,
    );
    process.exitCode = 1;
  }
}
