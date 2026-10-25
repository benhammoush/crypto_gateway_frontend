/** Exercise the actual packaged functions with payments disabled and all upstream fetches forbidden.
 * @file
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

for (const name of ["status", "payments", "webhook"]) {
  const path = resolve(
    `dist/_ci/functions/api/demo/${name}.func/api/demo/${name}.js`,
  );
  const probe = `
    import assert from 'node:assert/strict';
    import {createServer, get} from 'node:http';
    import {pathToFileURL} from 'node:url';
    const {default:handler} = await import(pathToFileURL(process.argv[1]).href);
    globalThis.fetch = () => { throw Error('Upstream access forbidden'); };
    const server = createServer((req, res) => { void handler(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const body = await new Promise((resolve, reject) => {
        get('http://127.0.0.1:' + server.address().port + '/api/demo/status', res => {
          let text = '';
          res.on('data', value => text += value);
          res.on('end', () => resolve(JSON.parse(text)));
        }).on('error', reject);
      });
      assert.deepEqual(body, {data:{enabled:false}});
    } finally { await new Promise(resolve => server.close(resolve)); }
  `;
  const output = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", probe, path],
    {
      env: { ...process.env, DEMO_ENABLED: "false" },
      encoding: "utf8",
      timeout: 15_000,
    },
  );
  assert.equal(output, "");
}
