import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Two build outputs from the same source, matching the recipe anchor app:
//   - `npm run build`        → dist/index.html + separate JS/CSS. What the
//                              Phase 8 bundler ingests on ZIP import.
//   - `npm run build:inline` → dist/index.html with everything inlined,
//                              for embedding as a single srcdoc HTML string.
export default defineConfig(({ mode }) => {
  const inline = mode === "inline";
  return {
    plugins: [react(), ...(inline ? [viteSingleFile()] : [])],
    server: {
      port: 5181,
      strictPort: false,
    },
    build: {
      target: "es2022",
      sourcemap: !inline,
      ...(inline
        ? {
            assetsInlineLimit: 100_000_000,
            cssCodeSplit: false,
            rollupOptions: { output: { inlineDynamicImports: true } },
          }
        : {}),
    },
  };
});
