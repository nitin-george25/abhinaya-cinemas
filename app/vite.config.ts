/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The admin DCR console deploys to its own Cloudflare Pages project at
// admin.abhinayacinemas.com, so the app is served at the root of that
// hostname (basename "/"). Previously it lived at /admin/dcr/ on the
// shared apex domain — see git log for the subdomain-split commit.
export default defineConfig({
  plugins: [react()],
  base: "/",
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
