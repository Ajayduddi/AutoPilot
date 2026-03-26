import { Router } from 'express';
import { requireWebhookSecret } from '../middleware/webhook.middleware';
import { validate } from '../middleware/validate.middleware';
import { n8nCallbackSchema, unifiedCallbackSchema } from '../schemas/webhook.schema';
import { WorkflowService } from '../services/workflow.service';
import { ChatService } from '../services/chat.service';
import { NotificationService } from '../services/notification.service';

const router = Router();

// ── n8n callback endpoint (backward-compatible) ─────────────────────────────
router.post('/n8n', requireWebhookSecret, validate(n8nCallbackSchema), async (req, res, next) => {
  try {
    const payload = req.body;

    const run = await WorkflowService.getRunById(payload.runId);
    if (!run) {
      return res.status(404).json({ error: 'Run ID not found' });
    }

    if (payload.type === 'completed') {
      await WorkflowService.updateRunStatus(
        payload.runId, 'completed',
        { summary: 'Workflow completed', data: payload.result || {}, items: [] },
        payload.result,
      );

      if (run.threadId) {
        await ChatService.addMessage(run.threadId, 'assistant', `Workflow execution finished successfully.`);
      } else {
        await NotificationService.notify(run.userId, {
          type: 'workflow_event',
          title: 'Workflow Completed',
          message: 'Your automation executed successfully.',
          runId: run.id,
        });
      }
    } else if (payload.type === 'error') {
      await WorkflowService.updateRunStatus(
        payload.runId, 'failed', undefined, undefined,
        { error: payload.error },
      );

      if (run.threadId) {
        await ChatService.addMessage(run.threadId, 'assistant', `Workflow failed: ${payload.error}`);
      } else {
        await NotificationService.notify(run.userId, {
          type: 'system',
          title: 'Workflow Error',
          message: `An automation failed to execute: ${payload.error}`,
          runId: run.id,
        });
      }
    }

    res.json({ status: 'ok', receipt: 'processed' });
  } catch (err) {
    next(err);
  }
});

// ── Unified provider callback endpoint ──────────────────────────────────────
// Accepts callbacks from any provider using the standard callback shape
router.post('/callback', requireWebhookSecret, validate(unifiedCallbackSchema), async (req, res, next) => {
  try {
    const payload = req.body;

    // Look up run by trace_id (providers send this back)
    const run = await WorkflowService.getRunByTraceId(payload.traceId);
    if (!run) {
      return res.status(404).json({ error: 'No run found for trace_id' });
    }

    const normalizedOutput = payload.result
      ? { summary: 'Workflow completed', data: payload.result, items: [] }
      : null;

    await WorkflowService.updateRunStatus(
      run.id,
      payload.status,
      normalizedOutput,
      payload.raw || payload.result,
      payload.error ? { error: payload.error } : undefined,
    );

    if (run.threadId) {
      const msg = payload.status === 'completed'
        ? 'Workflow execution finished successfully.'
        : payload.status === 'failed'
          ? `Workflow failed: ${JSON.stringify(payload.error)}`
          : `Workflow status updated: ${payload.status}`;
      await ChatService.addMessage(run.threadId, 'assistant', msg);
    } else {
      const isTerminal = payload.status === 'completed' || payload.status === 'failed';
      if (isTerminal) {
        await NotificationService.notify(run.userId, {
          type: payload.status === 'completed' ? 'workflow_event' : 'system',
          title: payload.status === 'completed' ? 'Workflow Completed' : 'Workflow Failed',
          message: payload.status === 'completed'
            ? 'Your automation executed successfully.'
            : `An automation failed: ${JSON.stringify(payload.error)}`,
          runId: run.id,
        });
      }
    }

    res.json({ status: 'ok', receipt: 'processed' });
  } catch (err) {
    next(err);
  }
});

export { router as webhooksRouter };
