/**
 * @fileoverview apps/frontend/app.config.ts
 *
 * High-level purpose:
 * Frontend configuration module defining runtime/build/test behavior for the application lifecycle.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Centralizes framework and tooling configuration defaults.
 * - Supports environment-specific behavior through typed options.
 * - Improves reproducibility across local and CI execution.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Update configuration values for target environment needs.
 * 2. Keep config changes aligned with scripts and project docs.
 * 3. Validate by running associated frontend build/test commands.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
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
    build: {
      // Vinxi expects a top-level manifest.json for each router output.
      // Vite 6 defaults to .vite/manifest.json, which can break Vinxi post-build reads.
      manifest: "manifest.json",
    },
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
