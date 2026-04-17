const SCAN_ROOTS = [
  "apps/backend/src",
  "apps/frontend/src",
  "packages/shared/src",
];

const ALLOWED_MATCHES = new Set([
  "apps/backend/src/config/runtime-config-io.ts",
  "apps/backend/src/util/auth-crypto.ts",
  "apps/backend/src/util/filesystem-compat.ts",
]);

const rg = Bun.spawnSync([
  "rg",
  "-n",
  "from ['\\\"](node:|fs|path|os|crypto|util|http|https|stream|buffer)['\\\"]|require\\(['\\\"]fs['\\\"]\\)|require\\(['\\\"]crypto['\\\"]\\)|Buffer\\.",
  ...SCAN_ROOTS,
], {
  stdout: "pipe",
  stderr: "pipe",
});

const output = rg.stdout.toString().trim();
const violations: string[] = [];

if (output) {
  for (const line of output.split("\n")) {
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    if (firstColon <= 0 || secondColon <= firstColon) continue;
    const path = line.slice(0, firstColon);
    if (path.includes("/db/")) continue;
    if (ALLOWED_MATCHES.has(path)) continue;
    violations.push(line);
  }
}

if (violations.length > 0) {
  console.error("[bun-native] Found forbidden Node runtime usage in app/runtime paths:");
  for (const violation of violations) {
    console.error(` - ${violation}`);
  }
  process.exit(1);
}

console.log("[bun-native] OK: no forbidden Node runtime usage outside approved compatibility seams.");
