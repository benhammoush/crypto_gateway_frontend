/** Run one dev-only synthetic log check using an existing server credential in memory.
 * @file
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const gateway = 'https://crypto-gateway-dev.benhxm.workers.dev';
const merchantKey = 'DEMO_MERCHANT_API_KEY';

/** Source-defined failure safe for job logs; never retain provider errors. */
class CheckError extends Error {}

/** Fail closed without sensitive assertion values.
 * @param condition - Guard that must hold.
 * @param code - Source-defined failure classification.
 */
function requireValue(condition, code) {
  if (!condition) throw new CheckError(code);
}

/** Parse bounded JSON without retaining raw bodies in errors or files.
 * @param response - Provider or gateway response.
 * @returns Parsed JSON within the size bound.
 */
async function json(response) {
  const reader = response.body?.getReader();
  requireValue(reader, 'RESPONSE_BODY_MISSING');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requireValue(size <= 131_072, 'RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Read only the verified dev project's metadata or in-memory environment values.
 * @param path - Internally constructed Vercel path.
 * @param token - Existing dev Vercel credential, kept in memory.
 * @param fetcher - Injectable transport with no retries.
 * @returns Parsed provider response without exporting it.
 */
async function readVercel(path, token, fetcher) {
  const response = await fetcher(`https://api.vercel.com${path}`, {
    headers: { authorization: `Bearer ${token}` },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new CheckError(`VERCEL_READ_HTTP_${response.status}`);
  }
  return json(response);
}

/** Perform one confirmed synthetic dev check, without payments or secret changes.
 * @param env - Exact manual-main source, confirmation and existing dev identities.
 * @param fetcher - Injectable transport; never retries the synthetic POST.
 * @returns Safe lookup reference and canary, not hosted privacy acceptance.
 */
export async function checkSupportLog(env, fetcher = globalThis.fetch) {
  requireValue(
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      env.GITHUB_REF === 'refs/heads/main' &&
      env.GITHUB_RUN_ATTEMPT === '1' &&
      /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
      env.EXPECTED_SHA === env.GITHUB_SHA &&
      env.CONFIRM === `dev-log-check:${env.GITHUB_SHA}` &&
      env.LOG_CHECK_ENVIRONMENT === 'dev',
    'NEW_CONFIRMED_MANUAL_MAIN_REQUIRED',
  );
  requireValue(
    /^team_[a-zA-Z0-9]+$/.test(env.VERCEL_ORG_ID ?? '') &&
      /^prj_[a-zA-Z0-9]+$/.test(env.VERCEL_PROJECT_ID ?? '') &&
      /^prj_[a-zA-Z0-9]+$/.test(env.OTHER_VERCEL_PROJECT_ID ?? '') &&
      env.VERCEL_PROJECT_ID !== env.OTHER_VERCEL_PROJECT_ID &&
      Boolean(env.VERCEL_TOKEN) &&
      env.VITE_API_ORIGIN === gateway &&
      env.TARGET_ORIGIN === 'https://crypto-gateway-dev.vercel.app',
    'ISOLATED_DEV_CONFIGURATION_REQUIRED',
  );
  const suffix = `?teamId=${env.VERCEL_ORG_ID}`;
  const project = await readVercel(
    `/v9/projects/${env.VERCEL_PROJECT_ID}${suffix}`,
    env.VERCEL_TOKEN,
    fetcher,
  );
  requireValue(
    project.id === env.VERCEL_PROJECT_ID &&
      project.accountId === env.VERCEL_ORG_ID &&
      project.name === 'crypto-gateway-dev' &&
      !project.link &&
      Array.isArray(project.env),
    'DEV_PROJECT_IDENTITY_MISMATCH',
  );
  const matches = project.env.filter(
    (entry) =>
      entry.key === merchantKey &&
      !entry.gitBranch &&
      (Array.isArray(entry.target) ? entry.target : [entry.target]).includes(
        'production',
      ),
  );
  requireValue(matches.length === 1, 'UNIQUE_DEV_MERCHANT_KEY_REQUIRED');
  const entry = matches[0];
  requireValue(
    entry.type === 'encrypted' && /^[a-zA-Z0-9_-]+$/.test(entry.id ?? ''),
    'EXISTING_KEY_NOT_READABLE_NO_CHANGES',
  );
  // Vercel's per-ID operation can omit encrypted values; use its CLI-compatible read.
  const values = await readVercel(
    `/v10/projects/${env.VERCEL_PROJECT_ID}/env${suffix}&target=production&decrypt=true&source=vercel-cli:pull`,
    env.VERCEL_TOKEN,
    fetcher,
  );
  requireValue(
    Array.isArray(values.envs),
    'EXISTING_KEY_NOT_READABLE_NO_CHANGES',
  );
  const selected = values.envs.filter((value) => value.id === entry.id);
  requireValue(selected.length === 1, 'EXISTING_KEY_NOT_READABLE_NO_CHANGES');
  const secret = selected[0];
  requireValue(
    secret.key === merchantKey &&
      secret.id === entry.id &&
      secret.type === 'encrypted' &&
      secret.decrypted === true &&
      !secret.gitBranch &&
      (Array.isArray(secret.target) ? secret.target : [secret.target]).includes(
        'production',
      ) &&
      typeof secret.value === 'string' &&
      /^[\x21-\x7e]{16,512}$/.test(secret.value),
    'EXISTING_KEY_NOT_READABLE_NO_CHANGES',
  );
  const health = await fetcher(`${gateway}/health`, {
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  requireValue(health.status === 200, 'BACKEND_HEALTH_UNAVAILABLE');
  const healthBody = await json(health);
  requireValue(
    healthBody.data?.service === 'crypto_gateway_backend' &&
      healthBody.data?.version === '0.3.1',
    'BACKEND_LOG_CHECK_VERSION_REQUIRED',
  );
  const privacyCanary = `support-canary-${randomUUID()}`;
  try {
    const response = await fetcher(
      `${gateway}/v1/support/log-check?private=${privacyCanary}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret.value}`,
          'content-type': 'application/json',
          'x-support-canary': privacyCanary,
        },
        body: JSON.stringify({ private: privacyCanary }),
        redirect: 'error',
        signal: globalThis.AbortSignal.timeout(15_000),
      },
    );
    const body = await json(response);
    const requestId = body.error?.requestId;
    requireValue(
      response.status === 500 &&
        body.error?.code === 'SUPPORT_LOG_CHECK' &&
        /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId ?? '') &&
        requestId === response.headers.get('x-request-id'),
      'LOG_CHECK_UNCONFIRMED_NO_RETRY',
    );
    return {
      sourceSha: env.GITHUB_SHA,
      environment: 'dev',
      timeUtc: new Date().toISOString(),
      requestId,
      privacyCanary,
      code: 'SUPPORT_LOG_CHECK',
      hostedPrivacyAccepted: false,
    };
  } catch {
    throw new CheckError('LOG_CHECK_UNCONFIRMED_NO_RETRY');
  }
}

/** Retain only allowlisted result fields, never provider responses or credentials.
 * @param result - Internally constructed success or classified failure record.
 */
function recordResult(result) {
  writeFileSync(
    'support-log-check.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Dev synthetic support log check\n\n${JSON.stringify(result)}\n\nNo payment was attempted. Do not retry automatically. A confirmed reference still needs complete-event inspection in restricted Cloudflare stored logs.\n`,
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const result = await checkSupportLog(process.env);
    recordResult(result);
  } catch (error) {
    const code =
      error instanceof CheckError ? error.message : 'CHECK_FAILED_NO_RETRY';
    try {
      recordResult({
        code,
        timeUtc: new Date().toISOString(),
        hostedPrivacyAccepted: false,
      });
    } catch {
      process.stderr.write('Dev log check: EVIDENCE_WRITE_FAILED.\n');
    }
    process.stderr.write(
      `Dev log check: ${code}. Do not retry automatically.\n`,
    );
    process.exitCode = 1;
  }
}
