import { Router } from 'express';
import { ApprovalService } from '../services/approval.service';

const router = Router();

// Get pending approvals
router.get('/', async (req, res, next) => {
  try {
    const userId = "usr_admin";
    const approvals = await ApprovalService.getPending(userId);
    res.json({ status: 'ok', data: approvals });
  } catch (err) {
    next(err);
  }
});

// Resolve an approval manually
router.post('/:id/resolve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved' | 'rejected'

    const approval = await ApprovalService.resolve(id, status);
    // Note: n8n webhook callback/resume hook will be handled logically here in Stage 9
    
    res.json({ status: 'ok', data: approval });
  } catch (err) {
    next(err);
  }
});

// Create an approval request programmatically (from n8n callback)
router.post('/', async (req, res, next) => {
  try {
    const { runId, userId, summary, details } = req.body;
    const approval = await ApprovalService.request(runId, userId, summary, details);
    res.status(201).json({ status: 'ok', data: approval });
  } catch (err) {
    next(err);
  }
});

export { router as approvalsRouter };
