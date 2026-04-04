/**
 * @fileoverview routes/approvals.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { ApprovalService } from '../services/approval.service';
import { requireAuth } from '../middleware/auth.middleware';
import { requireWebhookSecret } from '../middleware/webhook.middleware';
import { validate } from '../middleware/validate.middleware';
import { WorkflowService } from '../services/workflow.service';
import { UserRepo } from '../repositories/user.repo';
import { createApprovalSchema } from '../schemas/approval.schema';

const router = Router();

function requireAuthOrWebhookSecret(req: any, res: any, next: any) {
  if (req.auth?.user) return next();
  return requireWebhookSecret(req, res, next);
}

// Get pending approvals
router.get('/', requireAuth, async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const approvals = await ApprovalService.getPending(userId);
    res.json({ status: 'ok', data: approvals });
  } catch (err) {
    next(err);
  }
});

// Resolve an approval manually
router.post('/:id/resolve', requireAuth, async (req, res, next) => {
  try {
        const id = String(req.params.id || '');
        const status = String(req.body?.status || '') as 'approved' | 'rejected';
    if (status !== 'approved' && status !== 'rejected') {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }

        const approval = await ApprovalService.resolve(id, req.auth!.user.id, status);
    // Note: n8n webhook callback/resume hook will be handled logically here in Stage 9
    if (!approval) {
      return res.status(404).json({ error: 'Approval not found' });
    }
    res.json({ status: 'ok', data: approval });
  } catch (err) {
    next(err);
  }
});

// Create an approval request programmatically (from n8n callback)
router.post('/', requireAuthOrWebhookSecret, validate(createApprovalSchema), async (req, res, next) => {
  try {
    const { runId, userId, summary, details } = req.body;
        const run = await WorkflowService.getRunById(String(runId));
    if (!run) {
      return res.status(404).json({ error: 'Workflow run not found' });
    }
        const ownerId = run.userId || (typeof userId === 'string' && userId) || req.auth?.user?.id || (await UserRepo.getAnyPrimaryUser())?.id;
    if (!ownerId) {
      return res.status(404).json({ error: 'No user available to assign approval' });
    }
    if (typeof userId === 'string' && userId && userId !== ownerId) {
      return res.status(400).json({ error: 'userId does not match workflow run owner' });
    }
    if (req.auth?.user?.id && ownerId !== req.auth.user.id) {
      return res.status(403).json({ error: 'Forbidden to create approvals for another user' });
    }
        const approval = await ApprovalService.request(
      runId,
      ownerId,
      summary,
      details,
      req.auth?.user?.id
        ? { type: 'user', id: req.auth.user.id }
        : { type: 'webhook', id: null },
    );
    res.status(201).json({ status: 'ok', data: approval });
  } catch (err) {
    next(err);
  }
});

export { router as approvalsRouter };
