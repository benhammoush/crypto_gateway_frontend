/** Required quality-check and tooling configuration regressions.
 * @file
 */

import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("builds for standalone browser tests but consumes the verified build in CI", () => {
  const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
  expect(scripts["test:e2e"]).toBe("npm run build && playwright test");
  expect(scripts["ci:browser"]).toBe("playwright test");
});
