const SCAN_ROOTS = [
  "apps/backend/src",
  "apps/frontend/src",
  "packages/shared/src",
];

const rg = Bun.spawnSync([
  "rg",
  "--files",
  ...SCAN_ROOTS,
], {
  stdout: "pipe",
  stderr: "pipe",
});

const files = rg.stdout.toString().trim().split("\n").filter(Boolean);

const sizes = await Promise.all(files.map(async (file) => {
  const text = await Bun.file(file).text();
  return {
    file,
    lines: text.split("\n").length,
  };
}));

const top = sizes
  .filter((entry) => !entry.file.includes("/db/"))
  .sort((a, b) => b.lines - a.lines)
  .slice(0, 20);

console.log("[runtime-module-sizes] Top runtime modules by line count:");
for (const entry of top) {
  console.log(`${entry.lines.toString().padStart(5, " ")}  ${entry.file}`);
}
