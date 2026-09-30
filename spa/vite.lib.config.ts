import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Library build: a single self-contained ES module (React, sigma, and the
// lazily-imported three.js stack inlined; styles injected at mount) that host
// systems can import and call mountWikiGraph() on.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../src"),
    },
  },
  define: {
    // React ships dev/prod switches on process.env.NODE_ENV, which does not
    // exist in host browsers.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  esbuild: {
    // Match the production React forced above: the JSX transform otherwise
    // follows the shell's NODE_ENV, and jsxDEV calls crash React's production
    // runtime when building with NODE_ENV=development or test.
    jsxDev: false,
  },
  build: {
    outDir: path.resolve(__dirname, "../dist/spa-lib"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(__dirname, "src/lib.tsx"),
      name: "WikiGraph",
      formats: ["es"],
      fileName: () => "wiki-graph.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
