/**
 * @fileoverview Database migration preflight checker.
 *
 * Runs integrity checks that must pass before applying schema migrations.
 * The script reports blocking issues and returns a non-zero exit code when
 * repair steps are required.
 *
 * @remarks
 * Designed for CI/CD and operational runbooks to prevent risky migrations.
 */
import * as dotenv from "dotenv";
import postgres from "postgres";
import { collectIntegritySnapshot, formatIntegritySummary } from "./integrity";

const envPath = decodeURIComponent(new URL("../../../../.env", import.meta.url).pathname);
dotenv.config({ path: envPath });

const connectionString = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/chat_automation";
const sql = postgres(connectionString, { prepare: false });

/**
 * Executes migration safety checks and prints a preflight report.
 *
 * @remarks
 * Exit semantics:
 * - `0`: no blocking integrity issues.
 * - `2`: blocking issues found; run repair flow before migrating.
 * - `1`: unexpected runtime failure.
 *
 * @example
 * ```bash
 * bun --filter=backend run db:preflight
 * ```
 */
async function main() {
    const snapshot = await collectIntegritySnapshot(sql);
  for (const line of formatIntegritySummary(snapshot)) {
    console.log(line);
  }

  if (snapshot.orphanWorkflowRuns.length > 0) {
    console.log("[db:preflight] Blocking: orphan workflow_runs detected.");
  }
  if (snapshot.orphanApprovals.length > 0) {
    console.log("[db:preflight] Blocking: orphan approvals detected.");
  }
  if (snapshot.orphanNotificationRuns.length > 0) {
    console.log("[db:preflight] Blocking: orphan notifications(run_id) detected.");
  }
  if (snapshot.duplicateGoogleSubs.length > 0) {
    console.log("[db:preflight] Blocking: duplicate non-null users.google_sub detected.");
  }

  if (snapshot.blockingIssueCount > 0) {
    console.log("[db:preflight] Failed. Run `bun run db:repair -- --analyze` then `bun run db:repair:apply` before migration.");
    process.exitCode = 2;
    return;
  }

  console.log("[db:preflight] OK. No blocking integrity issues found.");
}

main()
  .catch((err) => {
    console.error("[db:preflight] Failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
