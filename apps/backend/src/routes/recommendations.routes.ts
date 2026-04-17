/**
 * @fileoverview apps/backend/src/routes/recommendations.routes.ts
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
import { RecommendationService } from '../services/retrieval/recommendation.service';

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

function parseBool(input: unknown): boolean | undefined {
  if (typeof input === 'boolean') return input;
  if (typeof input !== 'string') return undefined;
  const normalized = input.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  return undefined;
}

router.get('/workflows/:id', async (req, res, next) => {
  try {
    const result = await RecommendationService.recommendSimilarWorkflows({
      workflowId: req.params.id,
      userId: req.auth!.user.id,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: {
        mode: result.mode,
        total: result.results.length,
        sourceWorkflowId: req.params.id,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/runs/:id', async (req, res, next) => {
  try {
    const result = await RecommendationService.recommendRelatedRuns({
      runId: req.params.id,
      userId: req.auth!.user.id,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
      onlyFailures: parseBool(req.query.onlyFailures),
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: {
        mode: result.mode,
        total: result.results.length,
        sourceRunId: req.params.id,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/documents/:id', async (req, res, next) => {
  try {
    const result = await RecommendationService.recommendRelatedDocumentChunks({
      attachmentId: req.params.id,
      userId: req.auth!.user.id,
      limit: parseLimit(req.query.limit),
      minScore: parseMinScore(req.query.minScore),
    });

    res.json({
      status: 'ok',
      data: result.results,
      meta: {
        mode: result.mode,
        total: result.results.length,
        sourceAttachmentId: req.params.id,
      },
    });
  } catch (err) {
    next(err);
  }
});

export { router as recommendationsRouter };
