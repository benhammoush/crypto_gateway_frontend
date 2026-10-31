/**
 * Browser-engine coverage and local-server ownership for checkout tests.
 * @packageDocumentation
 */

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid local Playwright port.');
// Pin both ends to IPv4: localhost may resolve differently in Node and Firefox.
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  workers: 1,
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  testDir: './tests/e2e',
  use: { baseURL, headless: true, trace: 'retain-on-failure' },
  webServer: {
    command: `npx --no-install vite preview --host 127.0.0.1 --strictPort --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
