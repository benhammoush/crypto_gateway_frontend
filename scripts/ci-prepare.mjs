/** Package native Node function bytes offline; never read server runtime secrets.
 * @file
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import ts from "typescript";

for (const name of ["status", "payments", "webhook"]) {
  const root = `dist/_ci/functions/api/demo/${name}.func`;
  for (const file of [`api/demo/${name}.ts`, "server/merchant.ts"]) {
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
    const destination = join(root, file.replace(/\.ts$/, ".js"));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, output);
  }
  writeFileSync(`${root}/package.json`, '{"type":"module"}\n');
  writeFileSync(
    `${root}/.vc-config.json`,
    `${JSON.stringify({ runtime: "nodejs24.x", handler: `api/demo/${name}.js`, launcherType: "Nodejs", shouldAddHelpers: false })}\n`,
  );
}
