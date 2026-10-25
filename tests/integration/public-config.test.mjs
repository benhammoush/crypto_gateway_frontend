/** Public build configuration isolation and rejection regressions.
 * @file
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import viteConfig from "../../vite.config.ts";

const directories = [];
const metadataKey = "VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG";
const app = { VITE_APP_ENV: "dev", VITE_API_ORIGIN: "https://api.example.com" };

/** Isolate env-file loading and generated artifacts from real project configuration. */
function directory() {
  const root = join(tmpdir(), "opencode");
  mkdirSync(root, { recursive: true });
  const path = mkdtempSync(join(root, "gateway-public-config-"));
  directories.push(path);
  return path;
}

/** Execute the existing guard with synthetic configuration, never provider credentials. */
function check(extra = {}, dotenv) {
  const cwd = directory();
  if (dotenv) writeFileSync(join(cwd, ".env.production"), dotenv);
  const base = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_")),
  );
  return spawnSync(process.execPath, [resolve("scripts/check-config.mjs")], {
    cwd,
    env: { ...base, ...app, ...extra },
    encoding: "utf8",
    timeout: 15_000,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe("exact public configuration boundary", () => {
  it("accepts only the exact injected metadata key without parsing or printing its value", () => {
    for (const value of [
      "",
      "not-json",
      '{"analytics":{"token":"synthetic-metadata-sentinel"}}',
    ]) {
      const result = check({ [metadataKey]: value });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("synthetic-metadata-sentinel");
    }
  });

  it.each([
    "VITE_MERCHANT_API_KEY",
    "VITE_JUPITER_API_KEY",
    "VITE_CHECKOUT_SECRET",
    "VITE_VERCEL_TOKEN",
    `${metadataKey}_EXTRA`,
    "VITE_API_ORIGIN_SECRET",
    "VITE_UNKNOWN",
  ])("still rejects %s without leaking the value", (key) => {
    const result = check({
      [key]: "synthetic-private-sentinel",
      [metadataKey]: "provider metadata",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Unexpected public configuration");
    expect(result.stderr).not.toContain("synthetic-private-sentinel");
  });

  it("rejects unknown VITE keys loaded from env files as well", () => {
    const result = check(
      {},
      "VITE_MERCHANT_API_KEY=synthetic-dotenv-sentinel\n",
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("synthetic-dotenv-sentinel");
  });

  it.each([
    { VITE_APP_ENV: "preview" },
    { VITE_API_ORIGIN: "http://api.example.com" },
    { VITE_API_ORIGIN: "https://user:password@api.example.com" },
    { VITE_API_ORIGIN: "https://api.example.com/path" },
  ])("retains application validation for %j", (extra) => {
    expect(check({ ...extra, [metadataKey]: "metadata" }).status).not.toBe(0);
  });

  it("exposes only the exact application keys in a real browser bundle, including bare env access", async () => {
    for (const [key, value] of Object.entries(app)) vi.stubEnv(key, value);
    vi.stubEnv(metadataKey, "synthetic-provider-private-sentinel");
    vi.stubEnv("VITE_API_ORIGIN_SECRET", "synthetic-prefix-private-sentinel");
    vi.stubEnv("DEMO_MERCHANT_API_KEY", "synthetic-server-private-sentinel");
    const config = await viteConfig({ mode: "production", command: "build" });
    expect(config.envPrefix).toEqual([]);
    const root = directory();
    const input = join(root, "probe.js");
    writeFileSync(
      input,
      `globalThis.result = {
      app: import.meta.env.VITE_APP_ENV,
      origin: import.meta.env.VITE_API_ORIGIN,
      provider: import.meta.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG,
      similar: import.meta.env.VITE_API_ORIGIN_SECRET,
      whole: import.meta.env
    };`,
    );
    const result = await build({
      ...config,
      configFile: false,
      root,
      envDir: root,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        rollupOptions: { input, output: { format: "iife" } },
      },
    });
    const code = result.output
      .filter((item) => item.type === "chunk")
      .map((item) => item.code)
      .join("\n");
    expect(code).not.toContain("synthetic-provider-private-sentinel");
    expect(code).not.toContain("synthetic-prefix-private-sentinel");
    expect(code).not.toContain("synthetic-server-private-sentinel");
    const context = {};
    runInNewContext(code, context, { timeout: 1000 });
    expect(context.result.app).toBe("dev");
    expect(context.result.origin).toBe(app.VITE_API_ORIGIN);
    expect(context.result.provider).toBeUndefined();
    expect(context.result.similar).toBeUndefined();
    expect(
      Object.keys(context.result.whole)
        .filter((key) => key.startsWith("VITE_"))
        .sort(),
    ).toEqual(["VITE_API_ORIGIN", "VITE_APP_ENV"]);
  });
});
