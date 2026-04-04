/**
 * @fileoverview routes/workflows.routes.
 *
 * Workflow CRUD, execution, validation, and connectivity test endpoints.
 */
import { Router } from 'express';
import { WorkflowService } from '../services/workflow.service';
import { validate } from '../middleware/validate.middleware';
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  triggerWorkflowSchema,
  testConnectionSchema,
} from '../schemas/workflow.schema';
import { assertSafeOutboundUrl } from '../util/network-safety';
import { incrementCounter, observeHistogram } from '../util/metrics';
const router = Router();

/**
 * Normalizes dynamic workflow route segments for metrics labeling.
 *
 * @param path - Raw request path.
 * @returns Path with high-cardinality identifiers replaced by stable tokens.
 */
function normalizeRoutePath(path: string): string {
  return String(path || '')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\bwf_[a-z0-9_-]+\b/gi, ':workflow')
    .replace(/\busr_[a-z0-9_-]+\b/gi, ':user');
}

router.use((req, res, next) => {
    const startedAt = Date.now();
  res.on('finish', () => {
        const routePath = normalizeRoutePath(req.path);
    observeHistogram('autopilot_workflow_route_latency_ms', Date.now() - startedAt, {
      method: req.method,
      route: routePath,
      status: res.statusCode,
    });
    incrementCounter('autopilot_workflow_route_requests_total', {
      method: req.method,
      route: routePath,
      status: res.statusCode,
    });
  });
  next();
});

// ─────────────────────────────────────────────────────────────
//  GET /api/workflows — List workflows with filters
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { provider, visibility, enabled, archived, search } = req.query;
        const userId = req.auth!.user.id;

        const workflows = await WorkflowService.listAccessible(userId, {
      provider: provider as string | undefined,
      visibility: visibility as string | undefined,
            enabled: enabled === undefined ? undefined : enabled === 'true',
            archived: archived === undefined ? undefined : archived === 'true',
      search: search as string | undefined,
    });

    res.json({
      status: 'ok',
      data: workflows,
      meta: { total: workflows.length },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/workflows/:id — Get workflow by ID (visibility enforced)
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const workflow = await WorkflowService.getById(req.params.id, userId);
    if (!workflow) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found or not accessible' },
      });
    }
    res.json({ status: 'ok', data: workflow });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/workflows — Create a new workflow
// ─────────────────────────────────────────────────────────────
router.post('/', validate(createWorkflowSchema), async (req, res, next) => {
  try {
        const data = req.body;
        const userId = req.auth!.user.id;

        const workflow = await WorkflowService.create({
      key: data.key,
      name: data.name,
      description: data.description,
      provider: data.provider,
      visibility: data.visibility,
      ownerUserId: userId,
      enabled: data.enabled,
      requiresApproval: data.requiresApproval,
      triggerMethod: data.triggerMethod,
      executionEndpoint: data.executionEndpoint,
      httpMethod: data.httpMethod,
      authType: data.authType,
      authConfig: data.authConfig,
      inputSchema: data.inputSchema,
      outputSchema: data.outputSchema,
      tags: data.tags,
      metadata: data.metadata,
    });

    res.status(201).json({
      status: 'ok',
      data: workflow,
      meta: { message: 'Workflow created successfully' },
    });
  } catch (err) {
    // Handle unique constraint violation on key
    if ((err as any)?.code === '23505') {
      return res.status(409).json({
        status: 'error',
        error: { code: 'DUPLICATE_KEY', message: 'A workflow with this key already exists' },
      });
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  PATCH /api/workflows/:id — Update workflow
// ─────────────────────────────────────────────────────────────
router.patch('/:id', validate(updateWorkflowSchema), async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const workflow = await WorkflowService.updateForUser(req.params.id as string, userId, req.body);
    if (!workflow) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found or not accessible' },
      });
    }
    res.json({
      status: 'ok',
      data: workflow,
      meta: { message: 'Workflow updated successfully' },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  DELETE /api/workflows/:id — Delete (hard delete) or archive
// ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const mode = req.query.mode === 'hard' ? 'hard' : 'archive';
        let workflow;

    if (mode === 'hard') {
      workflow = await WorkflowService.deleteForUser(req.params.id, userId);
    } else {
      workflow = await WorkflowService.archiveForUser(req.params.id, userId);
    }

    if (!workflow) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found' },
      });
    }

    res.json({
      status: 'ok',
      data: workflow,
            meta: { message: mode === 'hard' ? 'Workflow permanently deleted' : 'Workflow archived' },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/workflows/:id/trigger — Trigger workflow execution
// ─────────────────────────────────────────────────────────────
router.post('/:id/trigger', validate(triggerWorkflowSchema), async (req, res, next) => {
  try {
        const id = req.params.id as string;
    const { source, input } = req.body;
        const userId = req.auth!.user.id;

        const workflow = await WorkflowService.getById(id, userId);
    if (!workflow) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found or not accessible' },
      });
    }
    if (!workflow.enabled) {
      return res.status(422).json({
        status: 'error',
        error: { code: 'INVALID_STATE', message: 'Cannot trigger a disabled workflow' },
      });
    }
    if (workflow.archived) {
      return res.status(422).json({
        status: 'error',
        error: { code: 'INVALID_STATE', message: 'Cannot trigger an archived workflow' },
      });
    }
    if (!workflow.executionEndpoint) {
      return res.status(422).json({
        status: 'error',
        error: { code: 'NO_ENDPOINT', message: 'Workflow has no execution endpoint configured' },
      });
    }

        const run = await WorkflowService.execute(
      workflow.id as string,
      workflow.key as string,
      workflow.provider as string,
      workflow.executionEndpoint as string,
      userId,
      req.traceId,
      source,
      input,
    );

    res.status(202).json({
      status: 'accepted',
      data: {
        runId: run.id,
        workflowId: workflow.id as string,
        workflowKey: workflow.key as string,
        provider: workflow.provider as string,
        status: run.status,
        triggerSource: source,
        startedAt: run.startedAt,
      },
      meta: { message: 'Workflow execution dispatched' },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  GET /api/workflows/:id/runs — List runs for a workflow
// ─────────────────────────────────────────────────────────────
router.get('/:id/runs', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const workflow = await WorkflowService.getById(req.params.id, userId);
    if (!workflow) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found or not accessible' },
      });
    }

        const limit = req.query.limit ? Math.max(1, Math.min(200, parseInt(req.query.limit as string, 10))) : 50;
        const before = typeof req.query.before === 'string' ? req.query.before : undefined;
        const runs = await WorkflowService.getRunsByWorkflowId(req.params.id, limit, before);
        const nextCursor = runs.length >= limit ? runs[runs.length - 1]?.createdAt : null;

    res.json({
      status: 'ok',
      data: runs,
      meta: {
        workflowId: req.params.id,
        total: runs.length,
        limit,
        nextCursor,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/workflows/:id/validate — Validate workflow config
// ─────────────────────────────────────────────────────────────
router.post('/:id/validate', async (req, res, next) => {
  try {
        const userId = req.auth!.user.id;
        const result = await WorkflowService.validateWorkflowConfigForUser(req.params.id, userId);
    if (!result) {
      return res.status(404).json({
        status: 'error',
        error: { code: 'NOT_FOUND', message: 'Workflow not found or not accessible' },
      });
    }
    res.json({
      status: 'ok',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────
//  POST /api/workflows/test-connection — Test endpoint reachability
// ─────────────────────────────────────────────────────────────
router.post('/test-connection', validate(testConnectionSchema), async (req, res, next) => {
  try {
    const { executionEndpoint } = req.body;
        const safeEndpoint = assertSafeOutboundUrl(executionEndpoint, {
      allowPrivateLocalInDev: true,
      requireHttpsInProd: true,
    });

        const startedAt = Date.now();
    try {
            const response = await fetch(safeEndpoint.toString(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(10000),
      });
      res.json({
        status: 'ok',
        data: {
          reachable: response.ok || response.status < 500,
          httpStatus: response.status,
          latencyMs: Date.now() - startedAt,
        },
      });
    } catch (err) {
      res.json({
        status: 'ok',
        data: {
          reachable: false,
          httpStatus: null,
          latencyMs: Date.now() - startedAt,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * Workflow management router for CRUD, validation, and trigger operations.
 *
 * @remarks
 * Mounted at `/api/workflows` behind `requireAuth` in backend bootstrap.
 */
export { router as workflowsRouter };
