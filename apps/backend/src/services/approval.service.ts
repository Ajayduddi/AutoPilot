import { ApprovalRepo } from '../repositories/approval.repo';
import { eventBus, EventTypes } from './event.service';

export class ApprovalService {
  static async request(runId: string, userId: string, summary: string, details?: any) {
    const approval = await ApprovalRepo.createApprovalRequest(runId, userId, summary, details);
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
      eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, { type: 'approval_resolved', approval });
    }
    return approval;
  }
}
