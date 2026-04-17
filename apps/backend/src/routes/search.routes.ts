/**
 * @fileoverview apps/backend/src/routes/search.routes.ts
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
import { validate } from '../middleware/validate.middleware';
import {
  workflowSemanticSearchSchema,
  documentSemanticSearchSchema,
  runSemanticSearchSchema,
} from '../schemas/search.schema';
import { SemanticSearchService } from '../services/retrieval/semantic-search.service';

const router = Router();

function parseLimit(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseMinScore(input: unknown): number | undefined {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input === 'string' && input.trim()) {
    const parsed = Number(input);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) return undefined;
  return input.map((v) => String(v || '').trim()).filter(Boolean);
}

router.get('/workflows', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({
        status: 'error',
        error: { code: 'INVALID_QUERY', message: 'q is required' },
      });
    }

    const result = await SemanticSearchService.searchWorkflows({
      userId: req.auth!.user.id,
      query: q,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
      provider: typeof req.query.provider === 'string' ? req.query.provider : undefined,
      enabled: typeof req.query.enabled === 'string' ? req.query.enabled : undefined,
      archived: typeof req.query.archived === 'string' ? req.query.archived : undefined,
      visibility: req.query.visibility === 'public' || req.query.visibility === 'private'
        ? req.query.visibility
        : undefined,
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/workflows', validate(workflowSemanticSearchSchema), async (req, res, next) => {
  try {
    const result = await SemanticSearchService.searchWorkflows({
      userId: req.auth!.user.id,
      query: req.body.q,
      limit: req.body.limit,
      minScore: req.body.minScore,
      provider: req.body.provider,
      enabled: req.body.enabled,
      archived: req.body.archived,
      visibility: req.body.visibility,
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/documents', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({
        status: 'error',
        error: { code: 'INVALID_QUERY', message: 'q is required' },
      });
    }

    const attachmentIds = typeof req.query.attachmentIds === 'string'
      ? req.query.attachmentIds.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;

    const result = await SemanticSearchService.searchDocuments({
      userId: req.auth!.user.id,
      query: q,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
      threadId: typeof req.query.threadId === 'string' ? req.query.threadId : undefined,
      attachmentIds,
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/documents', validate(documentSemanticSearchSchema), async (req, res, next) => {
  try {
    const result = await SemanticSearchService.searchDocuments({
      userId: req.auth!.user.id,
      query: req.body.q,
      limit: req.body.limit,
      minScore: req.body.minScore,
      threadId: req.body.threadId,
      attachmentIds: toStringArray(req.body.attachmentIds),
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/runs', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.status(400).json({
        status: 'error',
        error: { code: 'INVALID_QUERY', message: 'q is required' },
      });
    }

    const status = req.query.status;
    const validStatus = status === 'queued' || status === 'running' || status === 'completed' || status === 'failed' || status === 'waiting_approval'
      ? status
      : undefined;

    const result = await SemanticSearchService.searchRuns({
      userId: req.auth!.user.id,
      query: q,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
      workflowId: typeof req.query.workflowId === 'string' ? req.query.workflowId : undefined,
      status: validStatus,
      threadId: typeof req.query.threadId === 'string' ? req.query.threadId : undefined,
      onlyFailures: typeof req.query.onlyFailures === 'string' ? req.query.onlyFailures : undefined,
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/runs', validate(runSemanticSearchSchema), async (req, res, next) => {
  try {
    const result = await SemanticSearchService.searchRuns({
      userId: req.auth!.user.id,
      query: req.body.q,
      limit: req.body.limit,
      minScore: req.body.minScore,
      workflowId: req.body.workflowId,
      status: req.body.status,
      threadId: req.body.threadId,
      onlyFailures: req.body.onlyFailures,
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: { mode: result.mode, total: result.results.length },
    });
  } catch (err) {
    next(err);
  }
});

export { router as searchRouter };
