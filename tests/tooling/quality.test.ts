/**
 * Guard the real quality configuration against weaker lint and audit defaults.
 * @packageDocumentation
 */

import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { expect, it } from "vitest";

const eslint = new ESLint();

it("rejects unhandled promises using the real TypeScript project", async () => {
  const [result] = await eslint.lintText(
    "/** Quality fixture.\n * @packageDocumentation\n */\nPromise.resolve(1);",
    { filePath: "src/api.ts" },
  );
  expect(result.fatalErrorCount).toBe(0);
  expect(result.messages.map((message) => message.ruleId)).toContain(
    "@typescript-eslint/no-floating-promises",
  );
}, 30_000);

it("rejects conditional React hooks", async () => {
  const [result] = await eslint.lintText(
    '/** Hook fixture.\n * @packageDocumentation\n */\nimport { useEffect } from "react";\n/** Render fixture.\n * @param flag - Whether the fixture renders.\n * @returns The empty view. */\nexport function Fixture(flag: boolean) { if (flag) useEffect(() => {}, []); return null; }',
    { filePath: "src/App.tsx" },
  );
  expect(result.fatalErrorCount).toBe(0);
  expect(result.messages.map((message) => message.ruleId)).toContain(
    "react-hooks/rules-of-hooks",
  );
});

it("retains zero-warning lint and full plus runtime dependency audits", () => {
  const { scripts } = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };
  expect(scripts.lint).toBe("eslint . --max-warnings 0");
  expect(scripts["audit:dependencies"]).toBe(
    "npm audit && npm audit --omit=dev",
  );
  expect(scripts["ci:quality"]).toContain("npm run audit:dependencies");
});
