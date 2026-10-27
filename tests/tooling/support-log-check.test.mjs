/** Synthetic credential, single-submission and workflow-boundary regressions; no live services.
 * @file
 */
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { checkSupportLog } from '../../scripts/support-log-check.mjs';

const gateway = 'https://crypto-gateway-dev.benhxm.workers.dev';
const requestId = '11111111-1111-4111-8111-111111111111';
const providerToken = 'fixture-provider-token';
const merchantToken = 'fixture-merchant-token';

/** Construct a confirmed manual-main fixture without real credentials.
 * @returns Isolated dev workflow inputs.
 */
function environment() {
  const sha = 'a'.repeat(40);
  return {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    EXPECTED_SHA: sha,
    CONFIRM: `dev-log-check:${sha}`,
    LOG_CHECK_ENVIRONMENT: 'dev',
    VERCEL_ORG_ID: 'team_fixture',
    VERCEL_PROJECT_ID: 'prj_dev',
    OTHER_VERCEL_PROJECT_ID: 'prj_prod',
    VERCEL_TOKEN: providerToken,
    TARGET_ORIGIN: 'https://crypto-gateway-dev.vercel.app',
    VITE_API_ORIGIN: gateway,
  };
}

/** Create isolated provider and gateway responses.
 * @returns Metadata, selected decrypted variable, health and synthetic response fixtures.
 */
function fixture() {
  const entry = {
    id: 'env_fixture',
    key: 'DEMO_MERCHANT_API_KEY',
    type: 'encrypted',
    target: ['production'],
  };
  return [
    {
      id: 'prj_dev',
      accountId: 'team_fixture',
      name: 'crypto-gateway-dev',
      env: [entry],
    },
    { ...entry, decrypted: true, value: merchantToken },
    { data: { service: 'crypto_gateway_backend', version: '0.3.1' } },
    { error: { code: 'SUPPORT_LOG_CHECK', requestId } },
  ];
}

/** Supply controlled sequential responses; never contact providers.
 * @param bodies - Synthetic response objects.
 * @returns Injectable recording transport.
 */
function transport(bodies = fixture()) {
  const remaining = [...bodies];
  return vi.fn(async () => {
    const index = bodies.length - remaining.length;
    const body = remaining.shift();
    return globalThis.Response.json(body, {
      status: index === 3 ? 500 : 200,
      headers: index === 3 ? { 'x-request-id': requestId } : {},
    });
  });
}

it('reads one selected key and sends exactly one dev synthetic POST, exporting no credentials', async () => {
  const fetcher = transport();
  const result = await checkSupportLog(environment(), fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    'https://api.vercel.com/v9/projects/prj_dev?teamId=team_fixture',
    'https://api.vercel.com/v1/projects/prj_dev/env/env_fixture?teamId=team_fixture',
    `${gateway}/health`,
    `${gateway}/v1/support/log-check?private=${result.privacyCanary}`,
  ]);
  for (const [, options] of fetcher.mock.calls) {
    expect(options.redirect).toBe('error');
    expect(options.signal).toBeInstanceOf(globalThis.AbortSignal);
  }
  expect(fetcher.mock.calls[0][1].headers.authorization).toBe(
    `Bearer ${providerToken}`,
  );
  expect(fetcher.mock.calls[1][1].headers.authorization).toBe(
    `Bearer ${providerToken}`,
  );
  expect(fetcher.mock.calls[2][1].headers).toBeUndefined();
  const post = fetcher.mock.calls[3][1];
  expect(post.method).toBe('POST');
  expect(post.headers.authorization).toBe(`Bearer ${merchantToken}`);
  expect(post.headers['x-support-canary']).toBe(result.privacyCanary);
  expect(JSON.parse(post.body)).toEqual({ private: result.privacyCanary });
  expect(result).toMatchObject({
    sourceSha: environment().GITHUB_SHA,
    environment: 'dev',
    requestId,
    code: 'SUPPORT_LOG_CHECK',
    hostedPrivacyAccepted: false,
  });
  expect(JSON.stringify(result)).not.toMatch(
    /fixture-provider-token|fixture-merchant-token|DEMO_MERCHANT_API_KEY/,
  );
});

it('rejects unconfirmed sources, reruns, production and nonisolated identities before network access', async () => {
  for (const change of [
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/task' },
    { GITHUB_RUN_ATTEMPT: '2' },
    { GITHUB_SHA: 'main' },
    { GITHUB_WORKFLOW_SHA: 'b'.repeat(40) },
    { EXPECTED_SHA: 'b'.repeat(40) },
    { CONFIRM: 'yes' },
    { LOG_CHECK_ENVIRONMENT: 'production' },
    { VERCEL_TOKEN: '' },
    { VERCEL_ORG_ID: '../other' },
    { OTHER_VERCEL_PROJECT_ID: 'prj_dev' },
    { VERCEL_PROJECT_ID: '../other' },
    { VITE_API_ORIGIN: 'https://attacker.example' },
    { TARGET_ORIGIN: 'https://production.example' },
  ]) {
    const fetcher = vi.fn();
    await expect(
      checkSupportLog({ ...environment(), ...change }, fetcher),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  }
});

it('rejects mismatched projects and missing, ambiguous, branch-specific or unreadable variables', async () => {
  for (const change of [
    { id: 'prj_prod' },
    { name: 'crypto-gateway-production' },
    { accountId: 'team_other' },
    { link: { repo: 'competing' } },
    { env: [] },
    { env: [fixture()[0].env[0], fixture()[0].env[0]] },
    { env: [{ ...fixture()[0].env[0], target: ['preview'] }] },
    { env: [{ ...fixture()[0].env[0], gitBranch: 'branch' }] },
    { env: [{ ...fixture()[0].env[0], type: 'sensitive' }] },
    { env: [{ ...fixture()[0].env[0], id: '../other' }] },
  ]) {
    const bodies = fixture();
    bodies[0] = { ...bodies[0], ...change };
    const fetcher = transport(bodies);
    await expect(checkSupportLog(environment(), fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  for (const change of [
    { id: 'other' },
    { key: 'other' },
    { type: 'plain' },
    { decrypted: false },
    { value: undefined },
    { value: 'bad\ncredential' },
  ]) {
    const bodies = fixture();
    bodies[1] = { ...bodies[1], ...change };
    const fetcher = transport(bodies);
    await expect(checkSupportLog(environment(), fetcher)).rejects.toThrow(
      'EXISTING_KEY_NOT_READABLE_NO_CHANGES',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  }
});

it('stops on denied provider reads without a fallback, secret output or POST', async () => {
  const fetcher = vi.fn(async () =>
    globalThis.Response.json({ private: providerToken }, { status: 403 }),
  );
  await expect(checkSupportLog(environment(), fetcher)).rejects.toThrow(
    'VERCEL_READ_HTTP_403',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('bounds and cancels oversized metadata', async () => {
  const cancel = vi.fn();
  const body = new globalThis.ReadableStream({
    /** Supply a bounded oversized fixture chunk.
     * @param controller - Controlled stream producer.
     */
    start(controller) {
      controller.enqueue(new Uint8Array(131_073));
    },
    cancel,
  });
  await expect(
    checkSupportLog(
      environment(),
      vi.fn(async () => new globalThis.Response(body)),
    ),
  ).rejects.toThrow('RESPONSE_TOO_LARGE');
  expect(cancel).toHaveBeenCalledOnce();
});

it('does not submit when the backend health/version is wrong', async () => {
  const bodies = fixture();
  bodies[2].data.version = '0.3.0';
  const fetcher = transport(bodies);
  await expect(checkSupportLog(environment(), fetcher)).rejects.toThrow(
    'BACKEND_LOG_CHECK_VERSION_REQUIRED',
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('never retries an uncertain POST or treats a mismatched reference as accepted', async () => {
  const firstReads = transport();
  const fetcher = vi.fn(async (...args) => {
    if (args[1].method === 'POST')
      throw new Error(`${merchantToken} private-provider-payload`);
    return firstReads(...args);
  });
  await expect(checkSupportLog(environment(), fetcher)).rejects.toThrow(
    'LOG_CHECK_UNCONFIRMED_NO_RETRY',
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
  const bodies = fixture();
  bodies[3].error.requestId = '22222222-2222-4222-8222-222222222222';
  const mismatch = transport(bodies);
  await expect(checkSupportLog(environment(), mismatch)).rejects.toThrow(
    'LOG_CHECK_UNCONFIRMED_NO_RETRY',
  );
  expect(mismatch).toHaveBeenCalledTimes(4);
});

it('never prints credential-bearing exceptions from the executable entry point', () => {
  const module = new URL(
    '../../scripts/support-log-check.mjs',
    import.meta.url,
  );
  const source = `process.argv[1] = ${JSON.stringify(fileURLToPath(module))}; globalThis.fetch = async () => { throw new Error('private-provider-payload ${providerToken} ${merchantToken}'); }; await import(${JSON.stringify(module.href)});`;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', source],
    { env: environment(), encoding: 'utf8' },
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('CHECK_FAILED_NO_RETRY');
  expect(result.stdout + result.stderr).not.toMatch(
    /private-provider-payload|fixture-provider-token|fixture-merchant-token/,
  );
});

it('keeps the manual workflow main-only, dev-only, pinned, serialized and free of dependency installation', () => {
  const workflow = readFileSync(
    '.github/workflows/check-dev-support-log.yml',
    'utf8',
  );
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).not.toMatch(
    /pull_request|\bpush:|production|npm ci|npm install|workflow_run/,
  );
  expect(workflow).toContain("github.ref == 'refs/heads/main'");
  expect(workflow).toContain('runs-on: ubuntu-24.04');
  expect(workflow).toContain('deployment: false');
  expect(workflow).toContain('name: dev');
  expect(workflow).toContain(
    'group: deploy-${{ github.repository_owner }}-${{ github.event.repository.name }}-dev',
  );
  expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain('persist-credentials: false');
  for (const action of workflow.matchAll(/uses: (\S+)/g))
    expect(action[1]).toMatch(/@[a-f0-9]{40}$/);
  expect(workflow).toContain('path: support-log-check.json');
});
