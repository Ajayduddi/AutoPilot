import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  ssr: false,
  server: {
    // Pin Nitro behavior across deploys to avoid compatibility-date drift.
    compatibilityDate: process.env.NITRO_COMPATIBILITY_DATE || "2026-04-04",
    nitro: {
      compatibilityDate: process.env.NITRO_COMPATIBILITY_DATE || "2026-04-04",
    }
  },
  vite: {
    resolve: {
      alias: {
        // Bun + Vite can load debug's browser CJS file as ESM without default export.
        // micromark dev tokenizer expects `import createDebug from "debug"`, so shim it.
        debug: "/src/shims/debug.ts",
        // unified imports `extend` as a default ESM export, but Bun may resolve CJS here.
        // Provide an ESM-compatible deep merge implementation.
        extend: "/src/shims/extend.ts",
      },
      // Prefer stable default/browser exports over `development` condition.
      // This avoids loading micromark dev builds that import CJS debug in ESM mode.
      conditions: ["browser", "module", "import", "default"],
    },
  },
});
