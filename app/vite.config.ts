import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During the C0–C7 migration we serve the new React app under /v2/ so the
// existing vanilla app at /admin/dcr/ keeps running for daily ops. After
// cutover (Phase C7) we'll change base back to '/'.
export default defineConfig({
  plugins: [react()],
  base: "/v2/",
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
});
