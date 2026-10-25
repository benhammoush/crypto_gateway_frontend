/** Hosted function entry-point routing and server adapter regressions.
 * @file
 */

import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";

it("loads every emitted function entry point in native Node ESM and serves disabled status", () => {
  const temp = join(tmpdir(), "opencode");
  mkdirSync(temp, { recursive: true });
  const root = mkdtempSync(join(temp, "gateway-function-esm-"));
  try {
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    for (const file of [
      "api/demo/status.ts",
      "api/demo/payments.ts",
      "api/demo/webhook.ts",
      "server/merchant.ts",
    ]) {
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
    // No Vitest/tsx/TS loader: exercise Node's actual emitted-JavaScript resolution.
    writeFileSync(
      join(root, "probe.mjs"),
      `
      import assert from 'node:assert/strict';
      import { createServer, request } from 'node:http';
      import status from './api/demo/status.js';
      import payments from './api/demo/payments.js';
      import webhook from './api/demo/webhook.js';
      assert.equal(typeof status, 'function');
      assert.equal(payments, status);
      assert.equal(webhook, status);
      globalThis.fetch = () => { throw new Error('Upstream calls are forbidden in this fixture.'); };
      const server = createServer((req, res) => { void status(req, res); });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const result = await new Promise((resolve, reject) => {
          const req = request({ hostname:'127.0.0.1', port:server.address().port, path:'/api/demo/status', method:'GET' }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve({ status:res.statusCode, cache:res.headers['cache-control'], body:JSON.parse(body) }));
          });
          req.on('error', reject);
          req.end();
        });
        assert.equal(result.status, 200);
        assert.equal(result.cache, 'no-store');
        assert.deepEqual(result.body, { data:{ enabled:false } });
        process.stdout.write('native-esm-status-ok');
      } finally {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    `,
    );
    const result = spawnSync(process.execPath, [join(root, "probe.mjs")], {
      cwd: root,
      env: {
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        DEMO_ENABLED: "false",
      },
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 65_536,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("native-esm-status-ok");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
