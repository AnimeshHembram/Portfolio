import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Compiles js/src/ into one classic script, js/radio.js, which radio.html
// loads with a plain <script> tag so the page works from file://.
// The stylesheet (css/radio.css) is a plain file and is not built.
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    outDir: "js",
    // js/ also holds the source (js/src/), so it must never be emptied.
    emptyOutDir: false,
    lib: {
      entry: "js/src/main.tsx",
      formats: ["iife"],
      name: "PortfolioRadio",
      fileName: () => "radio.js",
    },
  },
  test: {
    environment: "node",
    include: ["js/src/**/*.test.ts"],
  },
});
