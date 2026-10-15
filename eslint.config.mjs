import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", URL: "readonly" } },
  },
  js.configs.recommended,
  ...ts.configs.recommended,
);
