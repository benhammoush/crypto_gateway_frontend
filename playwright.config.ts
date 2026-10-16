import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local Playwright port.");
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  use: { baseURL, headless: true },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
