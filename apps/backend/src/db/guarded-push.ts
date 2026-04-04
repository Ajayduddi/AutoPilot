/**
 * @fileoverview db/guarded-push.
 *
 * Production-safe wrapper for schema push commands in development.
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

