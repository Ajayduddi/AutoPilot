/**
 * @fileoverview Database integrity repair runner.
 *
 * Analyzes and optionally repairs known integrity issues:
 * - orphan `workflow_runs`
 * - orphan `approvals`
 * - orphan `notifications.run_id`
 * - duplicate non-null `users.google_sub`
 *
 * @remarks
 * Use analyze mode first to review planned actions before applying changes.
 */
import * as dotenv from 'dotenv';
import path from 'path';
import postgres from 'postgres';
import {
  collectIntegritySnapshot,
  formatIntegritySummary,
  type DuplicateGoogleSub,
  type OrphanApproval,
  type OrphanNotificationRun,
  type OrphanWorkflowRun,
} from './integrity';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/chat_automation';
const sql = postgres(connectionString, { prepare: false });

/**
 * Deletes orphan workflow runs and dependent approval/notification rows.
 *
 * @param orphanIds - Workflow run IDs with broken workflow references.
 * @returns Count of deleted workflow run rows.
 */
async function deleteOrphanWorkflowRuns(orphanIds: string[]) {
  if (!orphanIds.length) return 0;

  await sql`delete from approvals where run_id = any(${orphanIds})`;
  await sql`delete from notifications where run_id = any(${orphanIds})`;
    const deleted = await sql<Array<{ id: string }>>`
    delete from workflow_runs
    where id = any(${orphanIds})
    returning id
  `;
  return deleted.length;
}

/**
 * Deletes orphan approvals whose `run_id` no longer exists.
 *
 * @param orphanIds - Approval IDs identified as orphaned.
 * @returns Count of deleted approval rows.
 */
async function deleteOrphanApprovals(orphanIds: string[]) {
  if (!orphanIds.length) return 0;
    const deleted = await sql<Array<{ id: string }>>`
    delete from approvals
    where id = any(${orphanIds})
    returning id
  `;
  return deleted.length;
}

/**
 * Deletes orphan notifications that reference missing workflow runs.
 *
 * @param orphanIds - Notification IDs identified as orphaned.
 * @returns Count of deleted notification rows.
 */
async function deleteOrphanNotificationRuns(orphanIds: string[]) {
  if (!orphanIds.length) return 0;
    const deleted = await sql<Array<{ id: string }>>`
    delete from notifications
    where id = any(${orphanIds})
    returning id
  `;
  return deleted.length;
}

/**
 * Resolves duplicate Google subject identifiers across users.
 *
 * @remarks
 * Keeps the earliest user ID in each duplicate set and nulls `google_sub`
 * for remaining rows to restore uniqueness safely.
 *
 * @param duplicates - Duplicate groups from integrity analysis.
 * @returns Number of user rows updated.
 */
async function fixDuplicateGoogleSubs(duplicates: DuplicateGoogleSub[]) {
    let updated = 0;
  for (const dup of duplicates) {
        const keepId = dup.user_ids[0];
        const clearIds = dup.user_ids.slice(1);
    if (!clearIds.length) continue;
    await sql`
      update users
      set google_sub = null
      where id = any(${clearIds})
    `;
    updated += clearIds.length;
    console.log(`[db:repair] Kept google_sub=${dup.google_sub} on ${keepId}, cleared duplicates on: ${clearIds.join(', ')}`);
  }
  return updated;
}

/**
 * Prints sampled orphan workflow runs for operator visibility.
 *
 * @param rows - Orphan workflow run rows.
 */
function printOrphanWorkflowRuns(rows: OrphanWorkflowRun[]) {
  if (!rows.length) return;
  for (const row of rows.slice(0, 20)) {
    console.log(`  - run=${row.id} workflow_id=${row.workflow_id} workflow_key=${row.workflow_key || 'null'} user=${row.user_id} thread=${row.thread_id || 'null'}`);
  }
  if (rows.length > 20) {
    console.log(`  ... ${rows.length - 20} more orphan workflow_runs`);
  }
}

/**
 * Prints sampled orphan approval rows for operator visibility.
 *
 * @param rows - Orphan approval rows.
 */
function printOrphanApprovals(rows: OrphanApproval[]) {
  if (!rows.length) return;
  for (const row of rows.slice(0, 20)) {
    console.log(`  - approval=${row.id} run_id=${row.run_id} user=${row.user_id} status=${row.status}`);
  }
  if (rows.length > 20) {
    console.log(`  ... ${rows.length - 20} more orphan approvals`);
  }
}

/**
 * Prints sampled orphan notification rows for operator visibility.
 *
 * @param rows - Orphan notification rows.
 */
function printOrphanNotifications(rows: OrphanNotificationRun[]) {
  if (!rows.length) return;
  for (const row of rows.slice(0, 20)) {
    console.log(`  - notification=${row.id} run_id=${row.run_id} user=${row.user_id} type=${row.type}`);
  }
  if (rows.length > 20) {
    console.log(`  ... ${rows.length - 20} more orphan notifications`);
  }
}

/**
 * Prints the planned repair action list based on the current snapshot.
 *
 * @param snapshot - Integrity snapshot produced during analysis.
 */
function printActionPlan(snapshot: {
    orphanWorkflowRuns: OrphanWorkflowRun[];
    orphanApprovals: OrphanApproval[];
    orphanNotificationRuns: OrphanNotificationRun[];
    duplicateGoogleSubs: DuplicateGoogleSub[];
}) {
  console.log('[db:repair] Planned actions:');
  if (snapshot.orphanWorkflowRuns.length) {
    console.log(`  1) Delete ${snapshot.orphanWorkflowRuns.length} orphan workflow_runs and dependent approvals/notifications by run_id`);
  }
  if (snapshot.orphanApprovals.length) {
    console.log(`  2) Delete ${snapshot.orphanApprovals.length} orphan approvals (run_id no longer exists)`);
  }
  if (snapshot.orphanNotificationRuns.length) {
    console.log(`  3) Delete ${snapshot.orphanNotificationRuns.length} orphan notifications (run_id no longer exists)`);
  }
  if (snapshot.duplicateGoogleSubs.length) {
    console.log(`  4) For ${snapshot.duplicateGoogleSubs.length} duplicate google_sub groups, keep earliest user and null others`);
  }
}

/**
 * Runs integrity analysis and optionally applies repair actions.
 *
 * @remarks
 * Default behavior is analyze-only mode unless `--apply` is provided.
 *
 * @example
 * ```bash
 * bun --filter backend run db:repair -- --analyze
 * bun --filter backend run db:repair -- --apply
 * ```
 */
async function main() {
    const apply = process.argv.includes('--apply');
    const analyzeOnly = process.argv.includes('--analyze') || !apply;

    const snapshot = await collectIntegritySnapshot(sql);
  for (const line of formatIntegritySummary(snapshot)) {
    console.log(line);
  }

  printOrphanWorkflowRuns(snapshot.orphanWorkflowRuns);
  printOrphanApprovals(snapshot.orphanApprovals);
  printOrphanNotifications(snapshot.orphanNotificationRuns);
  for (const dup of snapshot.duplicateGoogleSubs) {
    console.log(`  - google_sub=${dup.google_sub} count=${dup.count} users=${dup.user_ids.join(', ')}`);
  }
  printActionPlan(snapshot);

  if (analyzeOnly) {
    console.log('[db:repair] Analyze mode only. Re-run with --apply to execute the action plan.');
    return;
  }

    const deletedOrphanApprovals = await deleteOrphanApprovals(snapshot.orphanApprovals.map((row) => row.id));
    const deletedOrphanNotifications = await deleteOrphanNotificationRuns(snapshot.orphanNotificationRuns.map((row) => row.id));
    const deletedOrphans = await deleteOrphanWorkflowRuns(snapshot.orphanWorkflowRuns.map((row) => row.id));
    const clearedGoogleSubs = await fixDuplicateGoogleSubs(snapshot.duplicateGoogleSubs);

  console.log(`[db:repair] Deleted orphan approvals: ${deletedOrphanApprovals}`);
  console.log(`[db:repair] Deleted orphan notifications: ${deletedOrphanNotifications}`);
  console.log(`[db:repair] Deleted orphan workflow_runs: ${deletedOrphans}`);
  console.log(`[db:repair] Cleared duplicate google_sub values: ${clearedGoogleSubs}`);
}

main()
  .catch((err) => {
    console.error('[db:repair] Failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end({ timeout: 5 });
  });
