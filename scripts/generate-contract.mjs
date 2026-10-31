/** Generate or check browser types against the backend-owned OpenAPI contract.
 * @file
 */

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import openapiTS from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';

// Explicit source selection only; no sibling/main/latest fallback.
const checking = process.argv[2] === '--check';
const recorded = checking
  ? JSON.parse(await readFile('contract-source.json', 'utf8'))
  : undefined;
const [source, revision] = checking
  ? ['contract.openapi.json', recorded.revision]
  : process.argv.slice(2);
if (!source || !revision || !/^(?:local|[a-f0-9]{40})$/.test(revision)) {
  throw new Error(
    'Usage: npm run contract:generate -- <openapi.json> <full-backend-sha|local>',
  );
}
const text = await readFile(source, 'utf8');
const schema = JSON.parse(text);
assert.match(schema.openapi ?? '', /^3\.\d+\.\d+$/);
assert.equal(typeof schema.info?.version, 'string');
assert.ok(
  schema.paths &&
    typeof schema.paths === 'object' &&
    !Array.isArray(schema.paths),
);

// Keep local-reference and operation-identity guards while the older generator is pinned.
/** Reject unresolved or external references in the self-contained pinned contract.
 * @param value - JSON node whose descendants are checked against the root schema.
 */
function validateReferences(value) {
  if (!value || typeof value !== 'object') return;
  if ('$ref' in value) {
    assert.equal(typeof value.$ref, 'string');
    assert.ok(
      value.$ref.startsWith('#/'),
      'Contract references must be local.',
    );
    let target = schema;
    for (const part of value.$ref.slice(2).split('/')) {
      const key = decodeURIComponent(part)
        .replaceAll('~1', '/')
        .replaceAll('~0', '~');
      assert.ok(
        target && typeof target === 'object' && Object.hasOwn(target, key),
        'Unresolved contract reference.',
      );
      target = target[key];
    }
  }
  for (const child of Object.values(value)) validateReferences(child);
}
validateReferences(schema);
const operationIds = new Set();
for (const path of Object.values(schema.paths)) {
  for (const method of [
    'get',
    'put',
    'post',
    'delete',
    'options',
    'head',
    'patch',
    'trace',
  ]) {
    const id = path?.[method]?.operationId;
    if (id === undefined) continue;
    assert.equal(typeof id, 'string');
    assert.ok(!operationIds.has(id), 'Duplicate contract operationId.');
    operationIds.add(id);
  }
}
// Temporary 6.7.6 pin avoids Redocly's vulnerable matcher; revisit when v7 fixes it.
const output = await openapiTS(schema, { commentHeader: '' });
const canonical = await format(JSON.stringify(schema), { parser: 'json' });
const hash = createHash('sha256').update(canonical).digest('hex');
const types = await format(output, {
  ...(await resolveConfig('src/generated-api.ts')),
  parser: 'typescript',
});
if (checking) {
  if (
    recorded.sha256 !== hash ||
    recorded.version !== schema.info.version ||
    (await readFile('src/generated-api.ts', 'utf8')) !== types
  ) {
    throw new Error(
      'Contract snapshot/types/provenance differ. Regenerate from an explicit backend source.',
    );
  }
} else {
  await writeFile('src/generated-api.ts', types);
  await writeFile('contract.openapi.json', canonical);
  await writeFile(
    'contract-source.json',
    JSON.stringify(
      { version: schema.info.version, revision, sha256: hash },
      null,
      2,
    ) + '\n',
  );
}
