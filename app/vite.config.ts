/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase C7: cutover. The React app is now the primary console served at
// /admin/dcr/. The legacy vanilla app stays accessible at /admin/dcr-legacy/
// for fallback during the confidence period (~2 weeks). Old /v2/* URLs are
// 301-redirected by build.sh's _redirects file.
export default defineConfig({
  plugins: [react()],
  base: "/admin/dcr/",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
