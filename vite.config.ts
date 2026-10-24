/**
 * Vite browser build and server-only merchant development integration.
 * @packageDocumentation
 */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    // Disable automatic prefix-based exposure, including provider-injected data.
    // Only these two exact application keys may enter the browser bundle.
    envPrefix: [],
    define: {
      "import.meta.env.VITE_APP_ENV": JSON.stringify(env.VITE_APP_ENV),
      "import.meta.env.VITE_API_ORIGIN": JSON.stringify(env.VITE_API_ORIGIN),
    },
    server: {
      host: "localhost",
      port: 5173,
      strictPort: true,
      proxy: { "/api/demo": "http://127.0.0.1:3001" },
    },
  };
});
