/**
 * Browser-engine coverage and local-server ownership for checkout tests.
 * @packageDocumentation
 */

import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Invalid local Playwright port.');
const baseURL = `http://localhost:${port}`;

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
    command: `npm run preview -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
