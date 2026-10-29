/**
 * Unit and integration suite selection without browser end-to-end discovery.
 * @packageDocumentation
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['tests/setup.ts'],
    // Web3 publishes extensionless ESM imports that need Vite's browser resolution.
    server: { deps: { inline: [/@ant-design\/web3/] } },
    // Avoid saturating the host with jsdom, lint and build subprocesses together.
    maxWorkers: 2,
    include: ['tests/{unit,integration,tooling}/**/*.test.{ts,tsx,mjs}'],
  },
});
