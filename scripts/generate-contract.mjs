/** Generate or check browser types against the backend-owned OpenAPI contract.
 * @file
 */

import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import openapiTS, { astToString } from "openapi-typescript";
import { format } from "prettier";

// Explicit source selection only; no sibling/main/latest fallback.
const checking = process.argv[2] === "--check";
const recorded = checking
  ? JSON.parse(await readFile("contract-source.json", "utf8"))
  : undefined;
const [source, revision] = checking
  ? ["contract.openapi.json", recorded.revision]
  : process.argv.slice(2);
if (!source || !revision || !/^(?:local|[a-f0-9]{40})$/.test(revision)) {
  throw new Error(
    "Usage: npm run contract:generate -- <openapi.json> <full-backend-sha|local>",
  );
}
const text = await readFile(source, "utf8");
const schema = JSON.parse(text);
const ast = await openapiTS(schema);
const canonical = await format(JSON.stringify(schema), { parser: "json" });
const hash = createHash("sha256").update(canonical).digest("hex");
const types = await format(astToString(ast), { parser: "typescript" });
if (checking) {
  if (
    recorded.sha256 !== hash ||
    recorded.version !== schema.info.version ||
    (await readFile("src/generated-api.ts", "utf8")) !== types
  ) {
    throw new Error(
      "Contract snapshot/types/provenance differ. Regenerate from an explicit backend source.",
    );
  }
} else {
  await writeFile("src/generated-api.ts", types);
  await writeFile("contract.openapi.json", canonical);
  await writeFile(
    "contract-source.json",
    JSON.stringify(
      { version: schema.info.version, revision, sha256: hash },
      null,
      2,
    ) + "\n",
  );
}
