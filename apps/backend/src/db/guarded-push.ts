/**
 * @fileoverview db/guarded-push.
 *
 * High-level purpose:
 * Database schema, bootstrap, and operational safety helpers for persistence runtime.
 *
 * Key Features (and trade-offs):
 * - Defines schema/migration/seed and lifecycle utilities.
 * - Supports preflight and integrity checks for production safety.
 * - Provides shared DB access primitives for repositories.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Follow migration safety workflow before schema changes.
 * 3. Keep destructive operations guarded and explicit.
 * 4. Validate with DB preflight/typecheck as applicable.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { spawn } from "child_process";
function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}
async function main() {
    const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    console.error(
      "[db:push] blocked in production. Use migration workflow: bun run db:preflight -> bun run db:repair:analyze/apply (if needed) -> bun run db:migrate.",
    );
    process.exit(1);
    return;
  }

  await runCommand("bun", ["run", "db:preflight"]);
  await runCommand("drizzle-kit", ["push"]);
}

main().catch((err) => {
  console.error("[db:push] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

