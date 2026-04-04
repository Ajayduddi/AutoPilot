/**
 * @fileoverview routes/webhooks.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { requireWebhookSecret } from '../middleware/webhook.middleware';
import { validate } from '../middleware/validate.middleware';
import { n8nCallbackSchema, unifiedCallbackSchema } from '../schemas/webhook.schema';
import { WorkflowService } from '../services/workflow.service';
import { ChatService } from '../services/chat.service';
import { NotificationService } from '../services/notification.service';
import { WorkflowSummaryService } from '../services/workflow-summary.service';
import { rateLimit } from '../middleware/rate-limit.middleware';

const router = Router();
const webhookRateLimit = rateLimit({ keyPrefix: 'webhook-callbacks', limit: 120, windowMs: 60_000 });

async function notifyAutonomousWorkflowResult(params: {
    userId: string;
    runId: string;
    workflowKey: string;
    provider: string;
    traceId: string;
    status: 'completed' | 'failed';
  result?: unknown;
  raw?: unknown;
  error?: unknown;
}) {
    const summaryData = await WorkflowSummaryService.summarizeCallback({
    workflowKey: params.workflowKey,
    provider: params.provider,
    status: params.status,
    runId: params.runId,
    traceId: params.traceId,
    result: params.result,
    raw: params.raw,
    error: params.error,
  });

  await NotificationService.notify(params.userId, {
        type: params.status === 'completed' ? 'workflow_event' : 'system',
        title: params.status === 'completed'
      ? `Workflow completed: ${params.workflowKey}`
      : `Workflow failed: ${params.workflowKey}`,
    message: summaryData.summary,
    runId: params.runId,
    payload: summaryData,
  });
}

// ── n8n callback endpoint (backward-compatible) ─────────────────────────────
router.post('/n8n', webhookRateLimit, requireWebhookSecret, validate(n8nCallbackSchema), async (req, res, next) => {
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
      } else if (NotificationService.shouldNotifyWorkflowRun({ triggerSource: run.triggerSource, threadId: run.threadId })) {
        await notifyAutonomousWorkflowResult({
          userId: run.userId,
          runId: run.id,
          workflowKey: run.workflowKey,
          provider: run.provider,
          traceId: run.traceId,
          status: 'completed',
          result: payload.result,
          raw: payload.result,
        });
      }
    } else if (payload.type === 'error') {
      await WorkflowService.updateRunStatus(
        payload.runId, 'failed', undefined, undefined,
        { error: payload.error },
      );

      if (run.threadId) {
        await ChatService.addMessage(run.threadId, 'assistant', `Workflow failed: ${payload.error}`);
      } else if (NotificationService.shouldNotifyWorkflowRun({ triggerSource: run.triggerSource, threadId: run.threadId })) {
        await notifyAutonomousWorkflowResult({
          userId: run.userId,
          runId: run.id,
          workflowKey: run.workflowKey,
          provider: run.provider,
          traceId: run.traceId,
          status: 'failed',
          error: payload.error,
        });
      }
    }

    res.status(200).json({ status: 'ok', receipt: 'processed' });
  } catch (err) {
    next(err);
  }
});

// ── Unified provider callback endpoint ──────────────────────────────────────
// Accepts callbacks from any provider using the standard callback shape
router.post('/callback', webhookRateLimit, requireWebhookSecret, validate(unifiedCallbackSchema), async (req, res, next) => {
  try {
        const payload = req.body;
        const incomingTraceId = typeof payload.traceId === 'string' ? payload.traceId.trim() : '';

    // Preferred path: look up existing run by app-generated trace_id.
    // Fallback path: if trace_id is missing, create an external autonomous run.
        let run = incomingTraceId
      ? await WorkflowService.getRunByTraceId(incomingTraceId)
      : null;

    if (!run && !incomingTraceId) {
      run = await WorkflowService.createExternalCallbackRun({
        workflowKey: payload.workflowKey,
        provider: payload.provider,
        triggerSource: 'system',
      });
      if (!run) {
        return res.status(404).json({ error: 'Workflow not found for workflowKey' });
      }
    }

    if (!run) {
      return res.status(404).json({ error: 'No run found for trace_id' });
    }

        const normalizedOutput = payload.result
      ? {
          summary: payload.summary || 'Workflow completed',
          data: {
            ...(payload.result || {}),
            confidence: payload.confidence,
            nextSuggestedAction: payload.nextSuggestedAction,
            planStepId: payload.planStepId,
          },
          items: [],
        }
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
            const shouldNotify = NotificationService.shouldNotifyWorkflowRun({
        triggerSource: run.triggerSource,
        threadId: run.threadId,
      });
      if (isTerminal && shouldNotify) {
                const terminalStatus: 'completed' | 'failed' = payload.status === 'failed' ? 'failed' : 'completed';
        await notifyAutonomousWorkflowResult({
          userId: run.userId,
          runId: run.id,
          workflowKey: run.workflowKey,
          provider: run.provider,
          traceId: run.traceId,
          status: terminalStatus,
          result: payload.result,
          raw: payload.raw,
          error: payload.error,
        });
      }
    }

    res.status(200).json({
      status: 'ok',
      receipt: 'processed',
      data: {
        runId: run.id,
        traceId: run.traceId,
        createdFromCallback: !incomingTraceId,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as webhooksRouter };
