/**
 * @fileoverview services/approval.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { ApprovalRepo } from '../repositories/approval.repo';
import { eventBus, EventTypes } from './event.service';
import { WorkflowRepo } from '../repositories/workflow.repo';
import { ContextService } from './context.service';

/**
 * ApprovalService class.
 *
 * Encapsulates approval service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class ApprovalService {
  static async request(
    runId: string,
    userId: string,
    summary: string,
    details?: any,
    actor?: { type: 'user' | 'system' | 'webhook'; id?: string | null },
  ) {
        const normalizedDetails = (details && typeof details === 'object' && !Array.isArray(details)) ? details : {};
        const approval = await ApprovalRepo.createApprovalRequest(runId, userId, summary, {
      ...normalizedDetails,
      audit: {
        ...((normalizedDetails.audit && typeof normalizedDetails.audit === 'object' && !Array.isArray(normalizedDetails.audit))
          ? normalizedDetails.audit
          : {}),
        requestedByType: actor?.type || 'system',
        requestedById: actor?.id || null,
        requestedAt: new Date().toISOString(),
      },
    });
        const run = await WorkflowRepo.getRunById(runId);
    if (run?.threadId) {
      ContextService.indexAuditEvent({
        threadId: run.threadId,
        userId,
        workflowRunId: runId,
        workflowId: run.workflowId,
        action: 'approval_requested',
        summary: `Approval requested for workflow ${run.workflowKey}.`,
        metadata: {
          approvalId: approval.id,
          runId,
          workflowKey: run.workflowKey,
          requestedByType: actor?.type || 'system',
          requestedById: actor?.id || null,
        },
      }).catch(() => {});
    }
    eventBus.emit(EventTypes.WORKFLOW_APPROVAL_REQUESTED, approval);
    return approval;
  }

    static async getPending(userId: string) {
    return ApprovalRepo.getPendingApprovals(userId);
  }

    static async resolve(approvalId: string, userId: string, status: "approved" | "rejected") {
        const approval = await ApprovalRepo.resolveApproval(approvalId, userId, status);
    // When an approval is resolved, we could emit an event here to notify UI 
    // to dynamically update any pending approval cards!
    if (approval) {
            const run = await WorkflowRepo.getRunById(approval.runId);
      if (run?.threadId) {
        ContextService.indexAuditEvent({
          threadId: run.threadId,
          userId,
          workflowRunId: approval.runId,
          workflowId: run.workflowId,
                    action: status === 'approved' ? 'approval_approved' : 'approval_rejected',
          summary: `Approval ${status} for workflow ${run.workflowKey}.`,
          metadata: {
            approvalId: approval.id,
            runId: approval.runId,
            workflowKey: run.workflowKey,
            resolvedByUserId: userId,
          },
        }).catch(() => {});
      }
      eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, { type: 'approval_resolved', approval });
    }
    return approval;
  }
}
