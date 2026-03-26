// app.config.ts
import { defineConfig } from "@solidjs/start/config";
var app_config_default = defineConfig({
  ssr: false,
  vite: {
    resolve: {
      // Prefer stable default/browser exports over `development` condition.
      // This avoids loading micromark dev builds that import CJS debug in ESM mode.
      conditions: ["browser", "module", "import", "default"]
    }
  }
});
export {
  app_config_default as default
};
