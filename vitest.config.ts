import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/{unit,integration,tooling}/**/*.test.{ts,tsx,mjs}"],
  },
});
