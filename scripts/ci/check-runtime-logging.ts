const SCAN_ROOTS = [
  "apps/backend/src",
  "apps/frontend/src",
];

const ALLOWED_FILES = new Set([
  "apps/backend/src/util/logger.ts",
  "apps/frontend/src/lib/runtime-reporter.ts",
]);

const rg = Bun.spawnSync([
  "rg",
  "-n",
  "console\\.(error|warn|log|info|debug)",
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
    const content = line.slice(secondColon + 1).trim();
    if (ALLOWED_FILES.has(path)) continue;
    if (path.includes("/db/")) continue;
    if (content.startsWith("*") || content.startsWith("//")) continue;
    violations.push(line);
  }
}

if (violations.length > 0) {
  console.error("[runtime-logging] Found raw console usage in live runtime paths:");
  for (const violation of violations) {
    console.error(` - ${violation}`);
  }
  process.exit(1);
}

console.log("[runtime-logging] OK: no raw console usage outside approved runtime logging seams.");
