/**
 * @fileoverview Database migration preflight checker.
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
