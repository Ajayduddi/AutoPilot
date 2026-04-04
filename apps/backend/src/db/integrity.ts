/**
 * @fileoverview db/integrity.
 *
 * Integrity analysis helpers used by DB preflight and repair workflows.
 */
import type postgres from "postgres";

/**
 * Workflow run row that references a missing workflow definition.
 */
export type OrphanWorkflowRun = {
    id: string;
    workflow_id: string;
    workflow_key: string | null;
    user_id: string;
    thread_id: string | null;
    created_at: Date;
};

/**
 * Approval row whose `run_id` points to a non-existent workflow run.
 */
export type OrphanApproval = {
    id: string;
    run_id: string;
    user_id: string;
    status: string;
    created_at: Date;
};

/**
 * Notification row with a dangling `run_id` reference.
 */
export type OrphanNotificationRun = {
    id: string;
    run_id: string;
    user_id: string;
    type: string;
    created_at: Date;
};

/**
 * Duplicate group for non-null `users.google_sub` values.
 */
export type DuplicateGoogleSub = {
    google_sub: string;
    count: number;
    user_ids: string[];
};

/**
 * Consolidated integrity analysis output used by preflight/repair scripts.
 */
export type IntegritySnapshot = {
    orphanWorkflowRuns: OrphanWorkflowRun[];
    orphanApprovals: OrphanApproval[];
    orphanNotificationRuns: OrphanNotificationRun[];
    duplicateGoogleSubs: DuplicateGoogleSub[];
    blockingIssueCount: number;
};

/**
 * Finds workflow runs that no longer have a backing workflow row.
 *
 * @param sql - Postgres client used for querying integrity anomalies.
 * @returns Ordered list of orphan workflow run records.
 */
export async function findOrphanWorkflowRuns(sql: postgres.Sql): Promise<OrphanWorkflowRun[]> {
  return await sql<OrphanWorkflowRun[]>`
    select
      wr.id,
      wr.workflow_id,
      wr.workflow_key,
      wr.user_id,
      wr.thread_id,
      wr.created_at
    from workflow_runs wr
    left join workflows w on w.id = wr.workflow_id
    where w.id is null
    order by wr.created_at asc
  `;
}

/**
 * Finds approvals whose `run_id` references a deleted/missing workflow run.
 *
 * @param sql - Postgres client used for querying integrity anomalies.
 * @returns Ordered list of orphan approvals.
 */
export async function findOrphanApprovals(sql: postgres.Sql): Promise<OrphanApproval[]> {
  return await sql<OrphanApproval[]>`
    select
      a.id,
      a.run_id,
      a.user_id,
      a.status,
      a.created_at
    from approvals a
    left join workflow_runs wr on wr.id = a.run_id
    where wr.id is null
    order by a.created_at asc
  `;
}

/**
 * Finds notifications that reference missing workflow runs via `run_id`.
 *
 * @param sql - Postgres client used for querying integrity anomalies.
 * @returns Ordered list of orphan notifications.
 */
export async function findOrphanNotificationRuns(sql: postgres.Sql): Promise<OrphanNotificationRun[]> {
  return await sql<OrphanNotificationRun[]>`
    select
      n.id,
      n.run_id,
      n.user_id,
      n.type,
      n.created_at
    from notifications n
    left join workflow_runs wr on wr.id = n.run_id
    where n.run_id is not null and wr.id is null
    order by n.created_at asc
  `;
}

/**
 * Detects duplicate non-empty Google subject IDs across user rows.
 *
 * @remarks
 * The first (oldest) user ID is preserved as canonical during repair operations.
 *
 * @param sql - Postgres client used for querying integrity anomalies.
 * @returns Duplicate groups with affected user IDs in stable creation order.
 */
export async function findDuplicateGoogleSubs(sql: postgres.Sql): Promise<DuplicateGoogleSub[]> {
    const rows = await sql<Array<{ google_sub: string; count: number }>>`
    select google_sub, count(*)::int as count
    from users
    where google_sub is not null and trim(google_sub) <> ''
    group by google_sub
    having count(*) > 1
    order by count(*) desc, google_sub asc
  `;

    const out: DuplicateGoogleSub[] = [];
  for (const row of rows) {
        const users = await sql<Array<{ id: string }>>`
      select id from users
      where google_sub = ${row.google_sub}
      order by created_at asc
    `;
    out.push({
      google_sub: row.google_sub,
      count: row.count,
            user_ids: users.map((u) => u.id),
    });
  }
  return out;
}

/**
 * Collects all supported integrity checks in one snapshot.
 *
 * @param sql - Postgres client used for querying integrity anomalies.
 * @returns Snapshot used by preflight and repair flows.
 */
export async function collectIntegritySnapshot(sql: postgres.Sql): Promise<IntegritySnapshot> {
  const [orphanWorkflowRuns, orphanApprovals, orphanNotificationRuns, duplicateGoogleSubs] = await Promise.all([
    findOrphanWorkflowRuns(sql),
    findOrphanApprovals(sql),
    findOrphanNotificationRuns(sql),
    findDuplicateGoogleSubs(sql),
  ]);

    const blockingIssueCount =
    orphanWorkflowRuns.length + orphanApprovals.length + orphanNotificationRuns.length + duplicateGoogleSubs.length;

  return {
    orphanWorkflowRuns,
    orphanApprovals,
    orphanNotificationRuns,
    duplicateGoogleSubs,
    blockingIssueCount,
  };
}

/**
 * Formats integrity snapshot metrics for human-readable CLI output.
 *
 * @param snapshot - Integrity snapshot produced by `collectIntegritySnapshot`.
 * @returns Summary lines ready for logging/console rendering.
 */
export function formatIntegritySummary(snapshot: IntegritySnapshot): string[] {
  return [
    `[db:integrity] orphan workflow_runs: ${snapshot.orphanWorkflowRuns.length}`,
    `[db:integrity] orphan approvals: ${snapshot.orphanApprovals.length}`,
    `[db:integrity] orphan notifications(run_id): ${snapshot.orphanNotificationRuns.length}`,
    `[db:integrity] duplicate non-null users.google_sub: ${snapshot.duplicateGoogleSubs.length}`,
    `[db:integrity] blocking issues total: ${snapshot.blockingIssueCount}`,
  ];
}
