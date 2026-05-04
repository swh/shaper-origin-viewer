import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Production builds are deployed to GitHub Pages at /shaper-origin-viewer/, so
// asset URLs need that prefix baked in. Dev keeps the simpler root path.
export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" ? "/shaper-origin-viewer/" : "/",
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
}));
