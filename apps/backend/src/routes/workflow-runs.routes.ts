/**
 * @fileoverview routes/workflow-runs.routes.
 *
 * High-level purpose:
 * HTTP route surface that validates requests and delegates business logic to services.
 *
 * Key Features (and trade-offs):
 * - Schema-driven request validation and response normalization.
 * - Auth/rate-limit aware route composition for API boundaries.
 * - Thin handlers that preserve routes -> services -> repositories layering.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new endpoints by pairing route handlers with schemas.
 * 3. Delegate business decisions to service layer components.
 * 4. Verify contract changes with API and route tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { Router } from 'express';
import { WorkflowService } from '../services/workflow/workflow.service';

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
