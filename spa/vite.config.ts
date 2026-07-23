import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone SPA build: a relocatable static site (relative asset URLs) that
// can be copied into any host system or served from any sub-path / iframe.
export default defineConfig({
  root: __dirname,
  base: "./",
  plugins: [react()],
  publicDir: "public",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/spa"),
    emptyOutDir: true,
  },
  server: {
    port: Number(process.env.WIKIOS_SPA_DEV_PORT ?? "5214"),
  },
});
