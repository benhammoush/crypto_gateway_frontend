/**
 * Guard exact-source hosted delivery without cross-environment credentials.
 * Dev payment acceptance and compatible recovery remain manual prerequisites.
 * @file
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';

/**
 * Reject non-main, unpinned or non-isolated deployment configuration.
 * @param env - Selected GitHub environment configuration; never printed.
 * @param contract - Selected candidate's backend contract provenance.
 */
export function checkDelivery(env, contract) {
  assert.equal(env.GITHUB_REF, 'refs/heads/main');
  assert.match(env.SOURCE_SHA ?? '', /^[a-f0-9]{40}$/);
  assert.ok(['dev', 'production'].includes(env.DELIVERY_TARGET));
  assert.ok(['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME));
  if (env.DELIVERY_TARGET === 'production') {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch');
    assert.equal(
      env.GITHUB_RUN_ATTEMPT,
      '1',
      'Use a new dispatch and native approval.',
    );
  }
  assert.equal(env.VITE_APP_ENV, env.DELIVERY_TARGET);
  for (const value of [env.VITE_API_ORIGIN, env.TARGET_ORIGIN]) {
    const url = new URL(value);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.origin, value);
  }
  assert.match(env.VERCEL_ORG_ID ?? '', /^team_[a-zA-Z0-9]+$/);
  assert.match(env.VERCEL_PROJECT_ID ?? '', /^prj_[a-zA-Z0-9]+$/);
  assert.match(env.OTHER_VERCEL_PROJECT_ID ?? '', /^prj_[a-zA-Z0-9]+$/);
  assert.notEqual(env.VERCEL_PROJECT_ID, env.OTHER_VERCEL_PROJECT_ID);
  assert.ok(env.VERCEL_TOKEN, 'Missing environment deployment credential.');
  assert.match(
    contract.revision ?? '',
    /^[a-f0-9]{40}$/,
    'Hosted delivery requires an exact backend contract SHA, not local.',
  );
  assert.match(contract.sha256 ?? '', /^[a-f0-9]{64}$/);
}

/**
 * Compare the selected backend's canonical contract with committed provenance.
 * @param contract - Explicit backend source revision and expected schema hash.
 */
export async function checkBackendContract(contract) {
  assert.match(contract.revision ?? '', /^[a-f0-9]{40}$/);
  const response = await globalThis.fetch(
    `https://raw.githubusercontent.com/benhammoush/crypto_gateway_backend/${contract.revision}/openapi.json`,
    { redirect: 'error', signal: globalThis.AbortSignal.timeout(30_000) },
  );
  assert.ok(response.ok, 'Selected backend contract is unavailable.');
  const schema = await response.json();
  const canonical = await format(JSON.stringify(schema), { parser: 'json' });
  assert.equal(
    createHash('sha256').update(canonical).digest('hex'),
    contract.sha256,
    'Backend schema differs from the selected frontend contract.',
  );
}

/**
 * Verify only this target's project and retain any current immutable deployment ID.
 * No dev API is queried by a production run; native approval reviews dev manually.
 * An absent production target records the approved no-predecessor limitation,
 * not proof of empty provider history or completed dev acceptance/rehearsal.
 * @param env - The selected environment's provider identities and credential.
 * @returns Sanitized prior identity, not a claim of recovery eligibility.
 */
export async function currentTarget(env) {
  const response = await globalThis.fetch(
    `https://api.vercel.com/v9/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`,
    {
      headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` },
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(30_000),
    },
  );
  assert.ok(response.ok, 'Selected Vercel project is unavailable.');
  const project = await response.json();
  assert.equal(project.id, env.VERCEL_PROJECT_ID);
  assert.equal(project.accountId, env.VERCEL_ORG_ID);
  assert.equal(project.name, `crypto-gateway-${env.DELIVERY_TARGET}`);
  assert.ok(!project.link, 'Disconnect competing Vercel Git deployment.');
  const previous = project.targets?.production?.id ?? null;
  if (env.DELIVERY_TARGET === 'production') {
    assert.ok(
      project.targets?.production == null ||
        (typeof previous === 'string' && /^dpl_[a-zA-Z0-9]+$/.test(previous)),
      'Existing production target has no valid deployment identity; inspect provider.',
    );
  }
  return {
    project: project.id,
    previous,
    productionBootstrap:
      env.DELIVERY_TARGET === 'production' && previous === null,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const contract = JSON.parse(readFileSync('contract-source.json', 'utf8'));
    checkDelivery(process.env, contract);
    await checkBackendContract(contract);
    const previous = await currentTarget(process.env);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nBefore frontend mutation (recovery eligibility must be reviewed):\n\n${JSON.stringify(previous)}\n${previous.productionBootstrap ? '\nProduction bootstrap: no prior production restore identity is available. Confirm dev acceptance/rollback rehearsal and this limitation before approval; inspect provider state before any fresh recovery dispatch.\n' : ''}`,
    );
  } catch {
    process.stderr.write(
      'Delivery guard rejected the target. Review source, contract provenance, isolation and environment setup without sharing credential values.\n',
    );
    process.exitCode = 1;
  }
}
