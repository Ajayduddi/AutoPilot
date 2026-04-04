/**
 * @fileoverview routes/workflow-runs.routes.
 *
 * HTTP endpoints, request validation, and response composition for API resources.
 */
import { Router } from 'express';
import { WorkflowService } from '../services/workflow.service';

const router = Router();

// ─────────────────────────────────────────────────────────────
//  GET /api/workflow-runs/:runId — Structured run detail
// ─────────────────────────────────────────────────────────────
router.get('/:runId', async (req, res, next) => {
  try {
        const run = await WorkflowService.getRunById(req.params.runId);
    if (!run || run.userId !== req.auth!.user.id) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow run not found' },
      });
    }

    // Build structured response: normalized output in data, raw in _raw (for debugging)
        const response: Record<string, unknown> = {
      status: 'ok',
      data: {
        id: run.id,
        workflowId: run.workflowId,
        workflowKey: run.workflowKey,
        provider: run.provider,
        traceId: run.traceId,
        triggerSource: run.triggerSource,
        status: run.status,
        input: run.inputPayload,
        output: run.normalizedOutput,
        error: run.errorPayload,
        timing: {
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.finishedAt && run.startedAt
            ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
            : null,
        },
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      },
    };

    // Include raw provider response only if requested (for debugging)
    if (req.query.includeRaw === 'true') {
      (response.data as any)._raw = run.rawProviderResponse;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/workflow-runs/trace/:traceId — Lookup run by trace ID
// ─────────────────────────────────────────────────────────────
router.get('/trace/:traceId', async (req, res, next) => {
  try {
        const run = await WorkflowService.getRunByTraceId(req.params.traceId);
    if (!run || run.userId !== req.auth!.user.id) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'No run found for this trace ID' },
      });
    }

    res.json({
      status: 'ok',
      data: {
        id: run.id,
        workflowId: run.workflowId,
        workflowKey: run.workflowKey,
        provider: run.provider,
        traceId: run.traceId,
        triggerSource: run.triggerSource,
        status: run.status,
        output: run.normalizedOutput,
        error: run.errorPayload,
        timing: {
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.finishedAt && run.startedAt
            ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
            : null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as workflowRunsRouter };
