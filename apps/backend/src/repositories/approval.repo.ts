/**
 * @fileoverview repositories/approval.repo.
 *
 * Persistence helpers for workflow approval request and resolution state.
 */
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { approvals, workflowRuns } from '../db/schema';
import { randomUUID } from 'crypto';

/**
 * ApprovalRepo exported constant.
 */
export const ApprovalRepo = {
    async createApprovalRequest(runId: string, userId: string, summary: string, details?: any) {
        const id = `appr_${randomUUID()}`;
        const normalizedDetails = (details && typeof details === 'object' && !Array.isArray(details)) ? details : {};
    const [approval] = await db.insert(approvals).values({
      id,
      runId,
      userId,
      summary,
      details: normalizedDetails,
      status: 'pending',
    }).returning();
    
    // Auto update run status
    await db.update(workflowRuns).set({ status: 'waiting_approval' }).where(eq(workflowRuns.id, runId));
    
    return approval;
  },

    async resolveApproval(approvalId: string, userId: string, status: 'approved' | 'rejected') {
        const existing = await db.query.approvals.findFirst({
      where: and(eq(approvals.id, approvalId), eq(approvals.userId, userId)),
    });
    if (!existing || existing.status !== 'pending') {
      return null;
    }

        const resolvedAt = new Date();
        const existingDetails = (existing.details && typeof existing.details === 'object' && !Array.isArray(existing.details))
      ? existing.details as Record<string, unknown>
      : {};
        const audit = (existingDetails.audit && typeof existingDetails.audit === 'object' && !Array.isArray(existingDetails.audit))
      ? existingDetails.audit as Record<string, unknown>
      : {};

    const [approval] = await db.update(approvals)
      .set({
        status,
        resolvedAt,
        details: {
          ...existingDetails,
          audit: {
            ...audit,
            resolvedByUserId: userId,
            resolvedAt: resolvedAt.toISOString(),
            resolution: status,
          },
        },
      })
      .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
      .returning();

    if (approval && status === 'rejected') {
      await db.update(workflowRuns)
        .set({ status: 'failed', finishedAt: resolvedAt, updatedAt: resolvedAt })
        .where(eq(workflowRuns.id, approval.runId));
    }

    return approval;
  },

    async getPendingApprovals(userId: string) {
    return await db.query.approvals.findMany({
      where: and(
        eq(approvals.userId, userId),
        eq(approvals.status, 'pending')
      ),
            orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
  }
};
