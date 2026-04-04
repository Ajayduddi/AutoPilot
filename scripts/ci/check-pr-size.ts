/**
 * CI guardrail for pull-request size to reduce merge risk.
 *
 * Fails when changed file count exceeds threshold.
 */
const baseRef = Bun.env.GITHUB_BASE_REF?.trim();
const maxChangedFiles = Number.parseInt(Bun.env.PR_MAX_CHANGED_FILES || "180", 10);
const maxCrossSurfaceFiles = Number.parseInt(Bun.env.PR_MAX_CROSS_SURFACE_FILES || "120", 10);

if (!baseRef) {
  console.log("[pr-size] GITHUB_BASE_REF not set. Skipping PR size check.");
  process.exit(0);
}

const range = `origin/${baseRef}...HEAD`;
const hasBase = Bun.spawnSync(["git", "rev-parse", "--verify", `origin/${baseRef}`], {
  stdout: "ignore",
  stderr: "ignore",
});
if (hasBase.exitCode !== 0) {
  console.log(`[pr-size] Base ref origin/${baseRef} not available locally. Skipping check.`);
  process.exit(0);
}

const diff = Bun.spawnSync(["git", "diff", "--name-only", range], {
  stdout: "pipe",
  stderr: "pipe",
});

if (diff.exitCode !== 0) {
  const stderr = new TextDecoder().decode(diff.stderr).trim();
  console.error(`[pr-size] Failed to compute changed files for range ${range}.`);
  if (stderr) console.error(stderr);
  process.exit(1);
}

const stdout = new TextDecoder().decode(diff.stdout);
const files = stdout
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

console.log(`[pr-size] Changed files: ${files.length}. Threshold: ${maxChangedFiles}.`);

if (files.length > maxChangedFiles) {
  console.error(
    `[pr-size] PR is too large (${files.length} files). Split into smaller PR-sized batches (<= ${maxChangedFiles}).`,
  );
  process.exit(1);
}

const touchesBackend = files.some((file) => file.startsWith("apps/backend/"));
const touchesFrontend = files.some((file) => file.startsWith("apps/frontend/"));
if (touchesBackend && touchesFrontend && files.length > maxCrossSurfaceFiles) {
  console.error(
    `[pr-size] Cross-surface PR too large (${files.length} files across backend + frontend). ` +
      `Split into smaller batches (<= ${maxCrossSurfaceFiles}) per surface.`,
  );
  process.exit(1);
}

console.log("[pr-size] OK.");
