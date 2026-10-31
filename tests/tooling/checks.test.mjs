/** Required quality-check and tooling configuration regressions.
 * @file
 */

import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('builds for standalone browser tests but consumes the verified build in CI', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  expect(scripts['test:e2e']).toBe('npm run build && playwright test');
  expect(scripts['ci:browser']).toBe('playwright test');
});

it('pins the browser and owned preview server to the same IPv4 loopback address', () => {
  const config = readFileSync('playwright.config.ts', 'utf8');
  expect(config).toContain('const baseURL = `http://127.0.0.1:${port}`;');
  expect(config).toContain('use: { baseURL,');
  expect(config).toContain('url: baseURL,');
  expect(config).toContain(
    'vite preview --host 127.0.0.1 --strictPort --port ${port}',
  );
  expect(config).toContain('reuseExistingServer: false');
  expect(config).toContain('retries: 0');
});
