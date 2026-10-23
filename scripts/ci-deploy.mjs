/** Deploy the checked SPA and merchant functions without rebuilding or exposing runtime credentials. @file */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkDelivery, checkBackendContract } from "./check-delivery.mjs";

const env = process.env;
Object.assign(env, {
  SOURCE_SHA: env.CI_SOURCE_SHA,
  DELIVERY_TARGET: env.CI_ENVIRONMENT,
  VITE_APP_ENV: env.CI_ENVIRONMENT,
});
const config = JSON.parse(
  readFileSync(resolve(env.CI_CONTROL_ROOT, ".github/ci-cd.json"), "utf8"),
);
const buildEnvironment = config.buildEnvironment[env.CI_ENVIRONMENT];
assert.equal(
  env.VITE_API_ORIGIN,
  buildEnvironment.VITE_API_ORIGIN,
  "Public build/API configuration drifted",
);
const contract = JSON.parse(readFileSync("contract-source.json", "utf8"));
checkDelivery(env, contract);
await checkBackendContract(contract);
const { publishWeb } = await import(
  pathToFileURL(resolve(env.CI_AUTOMATION_ROOT, "scripts/providers.mjs")).href
);
await publishWeb(env, {
  name: `crypto-gateway-${env.CI_ENVIRONMENT}`,
  origin: env.TARGET_ORIGIN,
  buildEnvironment,
  hosting: {
    version: 3,
    routes: [
      {
        src: "/.*",
        headers: {
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        },
        continue: true,
      },
      { handle: "filesystem" },
      { src: "/checkout/[^/]+", dest: "/index.html" },
    ],
  },
  /** Read only the public status hint; never create a payment or reveal runtime configuration. */
  smoke: async (fetcher) => {
    const response = await fetcher(`${env.TARGET_ORIGIN}/api/demo/status`, {
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.data?.enabled, "boolean");
    assert.deepEqual(Object.keys(body.data), ["enabled"]);
  },
});
