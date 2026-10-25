/** Delivery configuration, artifact and provider identity regressions.
 * @file
 */

import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { format } from 'prettier';
import {
  checkBackendContract,
  checkDelivery,
  currentTarget,
} from '../../scripts/check-delivery.mjs';

/** Create synthetic environment-scoped release configuration.
 * @returns Isolated dev identities and nonfunctional fixture credentials.
 */
function environment() {
  return {
    DEPLOY_ENABLED: 'true',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_RUN_ATTEMPT: '1',
    SOURCE_SHA: 'a'.repeat(40),
    DELIVERY_TARGET: 'dev',
    VITE_APP_ENV: 'dev',
    VITE_API_ORIGIN: 'https://api.example.com',
    TARGET_ORIGIN: 'https://checkout.example.com',
    VERCEL_ORG_ID: 'team_test',
    VERCEL_PROJECT_ID: 'prj_dev',
    OTHER_VERCEL_PROJECT_ID: 'prj_production',
    VERCEL_TOKEN: 'synthetic',
  };
}
const contract = { revision: 'b'.repeat(40), sha256: 'c'.repeat(64) };
afterEach(() => vi.unstubAllGlobals());

it('requires isolated explicit configuration and immutable backend provenance', () => {
  expect(() => checkDelivery(environment(), contract)).not.toThrow();
  for (const [key, value] of [
    ['GITHUB_REF', 'refs/heads/feature'],
    ['SOURCE_SHA', 'main'],
    ['DELIVERY_TARGET', 'staging'],
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['VITE_APP_ENV', 'production'],
    ['VITE_API_ORIGIN', 'http://localhost:8787'],
    ['TARGET_ORIGIN', 'https://user:secret@example.com'],
    ['VERCEL_TOKEN', ''],
    ['OTHER_VERCEL_PROJECT_ID', 'prj_dev'],
  ])
    expect(() =>
      checkDelivery({ ...environment(), [key]: value }, contract),
    ).toThrow();
  expect(() =>
    checkDelivery(environment(), { ...contract, revision: 'local' }),
  ).toThrow();
});
it.each([undefined, 'false', 'true'])(
  'dev ignores deployment opt-in %s',
  (enabled) => {
    expect(() =>
      checkDelivery({ ...environment(), DEPLOY_ENABLED: enabled }, contract),
    ).not.toThrow();
  },
);
it('production requires a new manual dispatch and has no dev verification token', () => {
  const env = {
    ...environment(),
    DELIVERY_TARGET: 'production',
    VITE_APP_ENV: 'production',
  };
  expect(() => checkDelivery(env, contract)).toThrow();
  env.GITHUB_EVENT_NAME = 'workflow_dispatch';
  expect(() => checkDelivery(env, contract)).not.toThrow();
  for (const enabled of [undefined, 'false', 'true'])
    expect(() =>
      checkDelivery({ ...env, DEPLOY_ENABLED: enabled }, contract),
    ).not.toThrow();
  env.GITHUB_RUN_ATTEMPT = '2';
  expect(() => checkDelivery(env, contract)).toThrow();
});
it('compares the exact backend schema without a moving-ref fallback', async () => {
  const schema = { openapi: '3.0.3', info: { version: '0.1.0' } };
  const hash = createHash('sha256')
    .update(await format(JSON.stringify(schema), { parser: 'json' }))
    .digest('hex');
  const fetch = vi.fn(async () => ({
    ok: true,
    /** Return controlled project-schema evidence.
     * @returns The synthetic backend schema.
     */
    json: async () => schema,
  }));
  vi.stubGlobal('fetch', fetch);
  await checkBackendContract({ ...contract, sha256: hash });
  expect(fetch.mock.calls[0][0]).toContain(contract.revision);
  await expect(checkBackendContract(contract)).rejects.toThrow(
    'schema differs',
  );
});
it('gates delivery behind the existing quality/browser jobs and native target environment', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  expect(workflow).toContain('needs: verify');
  expect(workflow).toContain('environment: dev');
  expect(workflow).toMatch(
    /ci-cd-workflows\/\.github\/workflows\/deploy-web.yml@[a-f0-9]{40}/,
  );
  const production = readFileSync(
    '.github/workflows/deploy-production.yml',
    'utf8',
  );
  expect(production).toContain('needs: verify_release');
  expect(production).toContain('environment: production');
  expect(workflow).not.toContain('VERCEL_DEV_VERIFICATION_TOKEN');
});

it('reads only the selected target project and retains its prior identity', async () => {
  const env = environment();
  const project = {
    id: env.VERCEL_PROJECT_ID,
    accountId: env.VERCEL_ORG_ID,
    name: 'crypto-gateway-dev',
    targets: { production: { id: 'dpl_previous' } },
  };
  const fetch = vi.fn(async () => ({
    ok: true,
    /** Return the controlled project identity response.
     * @returns The synthetic provider project metadata.
     */
    json: async () => project,
  }));
  vi.stubGlobal('fetch', fetch);
  expect(await currentTarget(env)).toEqual({
    project: env.VERCEL_PROJECT_ID,
    previous: 'dpl_previous',
    productionBootstrap: false,
  });
  expect(fetch.mock.calls[0][0]).toContain('/projects/prj_dev?');
  project.name = 'other';
  await expect(currentTarget(env)).rejects.toThrow();
});

it('allows production bootstrap with an explicit no-predecessor record, not recovery acceptance', async () => {
  const env = {
    ...environment(),
    DELIVERY_TARGET: 'production',
    VERCEL_PROJECT_ID: 'prj_production',
    OTHER_VERCEL_PROJECT_ID: 'prj_dev',
  };
  const project = {
    id: env.VERCEL_PROJECT_ID,
    accountId: env.VERCEL_ORG_ID,
    name: 'crypto-gateway-production',
  };
  const fetch = vi.fn(async () => ({
    ok: true,
    /** Return the controlled project identity response.
     * @returns The synthetic provider project metadata.
     */
    json: async () => project,
  }));
  vi.stubGlobal('fetch', fetch);
  expect(await currentTarget(env)).toEqual({
    project: env.VERCEL_PROJECT_ID,
    previous: null,
    productionBootstrap: true,
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toContain('/projects/prj_production?');
  expect(fetch.mock.calls[0][1].method ?? 'GET').toBe('GET');
  for (const production of [
    {},
    { id: 'invalid' },
    { id: null },
    { id: ['dpl_previous'] },
  ]) {
    project.targets = { production };
    await expect(currentTarget(env)).rejects.toThrow(
      'no valid deployment identity',
    );
  }
  project.targets = { production: { id: 'dpl_previous' } };
  expect(await currentTarget(env)).toEqual({
    project: env.VERCEL_PROJECT_ID,
    previous: 'dpl_previous',
    productionBootstrap: false,
  });
});

it('never treats unavailable provider state as bootstrap or retries a failed inspection', async () => {
  const fetch = vi.fn(async () => ({ ok: false }));
  vi.stubGlobal('fetch', fetch);
  await expect(
    currentTarget({ ...environment(), DELIVERY_TARGET: 'production' }),
  ).rejects.toThrow('project is unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
});
