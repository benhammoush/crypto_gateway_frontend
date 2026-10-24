/** Reject unsafe public build configuration before bundling.
 * @file
 */

import { loadEnv } from "vite";
const env = {
  ...loadEnv("production", process.cwd(), "VITE_"),
  ...process.env,
};
if (!["local", "dev", "production"].includes(env.VITE_APP_ENV))
  throw new Error("Set VITE_APP_ENV explicitly.");
const url = new URL(env.VITE_API_ORIGIN ?? "");
if (
  url.origin !== env.VITE_API_ORIGIN ||
  url.username ||
  url.password ||
  (env.VITE_APP_ENV === "local"
    ? url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    : url.protocol !== "https:")
)
  throw new Error("Invalid VITE_API_ORIGIN.");
for (const key of Object.keys(env)) {
  if (
    key.startsWith("VITE_") &&
    ![
      "VITE_APP_ENV",
      "VITE_API_ORIGIN",
      // Vercel injects this even with autoExposeSystemEnvs=false. Vite must
      // exclude it from client configuration; it is not an application input.
      "VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG",
    ].includes(key)
  ) {
    throw new Error(
      "Unexpected public configuration; review for secret exposure.",
    );
  }
}
