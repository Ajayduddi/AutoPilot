import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { approvals, workflowRuns } from '../db/schema';
import { randomUUID } from 'crypto';

export const ApprovalRepo = {
  async createApprovalRequest(runId: string, userId: string, summary: string, details?: any) {
    const id = `appr_${randomUUID()}`;
    const [approval] = await db.insert(approvals).values({
      id,
      runId,
      userId,
      summary,
      details,
      status: 'pending',
    }).returning();
    
    // Auto update run status
    await db.update(workflowRuns).set({ status: 'waiting_approval' }).where(eq(workflowRuns.id, runId));
    
    return approval;
  },

  async resolveApproval(approvalId: string, userId: string, status: 'approved' | 'rejected') {
    const [approval] = await db.update(approvals)
      .set({ status, resolvedAt: new Date() })
      .where(and(eq(approvals.id, approvalId), eq(approvals.userId, userId)))
      .returning();
      
    // The orchestration layer will handle resuming the n8n webhook
    return approval;
  },

  async getPendingApprovals(userId: string) {
    return await db.query.approvals.findMany({
      where: and(
        eq(approvals.userId, userId),
        eq(approvals.status, 'pending')
      )
    });
  }
};
