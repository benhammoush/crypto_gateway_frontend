/** Guard offline contract generation and drift checks during the temporary generator pin.
 * @file
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';

const script = resolve('scripts/generate-contract.mjs');
const files = [
  'contract.openapi.json',
  'contract-source.json',
  'src/generated-api.ts',
];
let directory;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'gateway-contract-'));
  mkdirSync(join(directory, 'src'));
  for (const file of [...files, '.prettierrc.json'])
    copyFileSync(file, join(directory, file));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Execute the real generator with only disposable contract files and no network.
 * @param args - Explicit generator/check arguments for this fixture.
 * @returns The bounded child result, including captured diagnostic output.
 */
function run(args = ['--check']) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

it('checks and regenerates the same pinned snapshot without changing provenance', () => {
  const before = files.map((file) =>
    readFileSync(join(directory, file), 'utf8'),
  );
  expect(run().status).toBe(0);
  expect(
    files.map((file) => readFileSync(join(directory, file), 'utf8')),
  ).toEqual(before);
  const { revision } = JSON.parse(before[1]);
  expect(run(['contract.openapi.json', revision]).status).toBe(0);
  expect(
    files.map((file) => readFileSync(join(directory, file), 'utf8')),
  ).toEqual(before);
}, 30_000);

it.each([
  'types',
  'hash',
  'version',
  'missing schema',
  'invalid JSON',
  'missing revision',
])('rejects contract drift or invalid input: %s', (fault) => {
  const provenancePath = join(directory, 'contract-source.json');
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  if (fault === 'types')
    writeFileSync(join(directory, 'src/generated-api.ts'), 'export {};\n');
  if (fault === 'hash') provenance.sha256 = '0'.repeat(64);
  if (fault === 'version') provenance.version = '999.0.0';
  if (fault === 'missing revision') delete provenance.revision;
  writeFileSync(provenancePath, JSON.stringify(provenance));
  if (fault === 'missing schema')
    rmSync(join(directory, 'contract.openapi.json'));
  if (fault === 'invalid JSON')
    writeFileSync(join(directory, 'contract.openapi.json'), '{');
  expect(run().status).not.toBe(0);
});

it.each([
  'missing version',
  'unresolved reference',
  'external reference',
  'duplicate operation',
])('rejects invalid schema before writing generated files: %s', (fault) => {
  const schemaPath = join(directory, 'contract.openapi.json');
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  if (fault === 'missing version') delete schema.openapi;
  if (fault === 'unresolved reference')
    schema.components.schemas.Payment = {
      $ref: '#/components/schemas/Missing',
    };
  if (fault === 'external reference')
    schema.components.schemas.Payment = {
      $ref: 'https://invalid.example/schema.json',
    };
  if (fault === 'duplicate operation')
    schema.paths['/v1/price'].get.operationId =
      schema.paths['/v1/payments'].post.operationId;
  writeFileSync(schemaPath, JSON.stringify(schema));
  const generated = readFileSync(
    join(directory, 'src/generated-api.ts'),
    'utf8',
  );
  const provenance = readFileSync(
    join(directory, 'contract-source.json'),
    'utf8',
  );
  const result = run(['contract.openapi.json', 'a'.repeat(40)]);
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(directory, 'src/generated-api.ts'), 'utf8')).toBe(
    generated,
  );
  expect(readFileSync(join(directory, 'contract-source.json'), 'utf8')).toBe(
    provenance,
  );
});
