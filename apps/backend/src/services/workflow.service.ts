/**
 * @fileoverview services/workflow.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { WorkflowRepo } from '../repositories/workflow.repo';
import type { CreateWorkflowInput, UpdateWorkflowInput } from '../repositories/workflow.repo';
import { eventBus, EventTypes } from './event.service';
import { NotificationService } from './notification.service';
import { ContextService } from './context.service';
import { WorkflowProviderFactory } from '../providers/workflow/factory';
import { UserRepo } from '../repositories/user.repo';
import type {
  WorkflowRunStatus,
  WorkflowTriggerSource,
  WorkflowProvider,
  WorkflowExecutionRequest,
  Workflow,
} from '@autopilot/shared';
import { randomUUID } from 'crypto';
const CALLBACK_BASE_URL = process.env.CALLBACK_BASE_URL || 'http://localhost:3000';

// ─────────────────────────────────────────────────────────────
//  Secret redaction helpers
// ─────────────────────────────────────────────────────────────
const SENSITIVE_KEYS = ['apiKey', 'api_key', 'secret', 'token', 'password', 'credential'];
function redactSecrets(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;
    const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.some(sk => key.toLowerCase().includes(sk.toLowerCase()))) {
      redacted[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      redacted[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Strip sensitive fields from a workflow before API response */
function sanitizeWorkflow(wf: Record<string, unknown>): Record<string, unknown> {
    const result = { ...wf };
  if (result.authConfig) {
    result.authConfig = redactSecrets(result.authConfig as Record<string, unknown>);
  }
  return result;
}

/** Check if a workflow is accessible by a given user */
function isAccessible(wf: { visibility: string; ownerUserId: string | null }, requestingUserId?: string): boolean {
  if (wf.visibility === 'public') return true;
  if (!wf.ownerUserId) return true; // No owner = accessible (single-user compat)
  if (requestingUserId && wf.ownerUserId === requestingUserId) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
//  Service
// ─────────────────────────────────────────────────────────────

/**
 * Domain service for workflow CRUD, execution, and run lifecycle orchestration.
 *
 * @example
 * ```typescript
 * const run = await WorkflowService.execute({
 *   workflowKey: "send_report",
 *   userId,
 *   source: "api",
 *   input: { period: "weekly" },
 * });
 * ```
 */
export class WorkflowService {
  // ── CRUD ─────────────────────────────────────────────────────

    static async create(data: Omit<CreateWorkflowInput, 'id'>) {
        const workflow = await WorkflowRepo.createWorkflow({ ...data, id: randomUUID() });
    return sanitizeWorkflow(workflow);
  }

    static async update(id: string, data: UpdateWorkflowInput) {
        const existing = await WorkflowRepo.getWorkflowById(id);
    if (!existing) return null;
        const workflow = await WorkflowRepo.updateWorkflow(id, data);
    return sanitizeWorkflow(workflow);
  }

    static async updateForUser(id: string, userId: string, data: UpdateWorkflowInput) {
        const existing = await this.getById(id, userId);
    if (!existing) return null;
    return this.update(id, data);
  }

    static async archive(id: string) {
        const existing = await WorkflowRepo.getWorkflowById(id);
    if (!existing) return null;
        const workflow = await WorkflowRepo.archiveWorkflow(id);
    return sanitizeWorkflow(workflow);
  }

    static async archiveForUser(id: string, userId: string) {
        const existing = await this.getById(id, userId);
    if (!existing) return null;
    return this.archive(id);
  }

    static async delete(id: string) {
        const existing = await WorkflowRepo.getWorkflowById(id);
    if (!existing) return null;
    return WorkflowRepo.deleteWorkflow(id);
  }

    static async deleteForUser(id: string, userId: string) {
        const existing = await this.getById(id, userId);
    if (!existing) return null;
    return this.delete(id);
  }

  // ── Queries (API-facing — sanitized, visibility enforced) ───

  static async getAll(filters?: {
    provider?: string;
    visibility?: string;
    enabled?: boolean;
    archived?: boolean;
    search?: string;
  }) {
        const workflows = await WorkflowRepo.getAllWorkflows(filters as any);
    return workflows.map(sanitizeWorkflow);
  }

  /**
   * Get workflow by ID with visibility enforcement.
   * Returns sanitized workflow (secrets redacted).
   */
  static async getById(id: string, requestingUserId?: string) {
        const workflow = await WorkflowRepo.getWorkflowById(id);
    if (!workflow) return null;
    if (!isAccessible(workflow, requestingUserId)) return null;
    return sanitizeWorkflow(workflow);
  }

    static async getByKey(key: string, requestingUserId?: string) {
        const workflow = await WorkflowRepo.getWorkflowByKey(key);
    if (!workflow) return null;
    if (!isAccessible(workflow, requestingUserId)) return null;
    return sanitizeWorkflow(workflow);
  }

  /**
   * List workflows with visibility enforcement (sanitized).
   */
  static async listAccessible(
    requestingUserId: string,
    filters?: {
      provider?: string;
      visibility?: string;
      enabled?: boolean;
      archived?: boolean;
      search?: string;
    },
  ) {
        const all = await WorkflowRepo.getAllWorkflows(filters as any);
    return all
      .filter(wf => isAccessible(wf, requestingUserId))
      .map(sanitizeWorkflow);
  }

  // ── Internal queries (raw Drizzle types — for service-to-service use) ──

  /** Get raw workflow by key — for orchestrator/internal services */
  static async getByKeyInternal(key: string) {
    return WorkflowRepo.getWorkflowByKey(key);
  }

  /** Get raw workflow by ID — for orchestrator/internal services */
  static async getByIdInternal(id: string) {
    return WorkflowRepo.getWorkflowById(id);
  }

  // ── Execution ────────────────────────────────────────────────

  /**
   * Execute a workflow through the unified provider adapter pipeline.
   */
  static async execute(
    workflowId: string,
    workflowKey: string,
    provider: string,
    executionEndpoint: string,
    userId: string,
    traceId: string,
    triggerSource: WorkflowTriggerSource,
    payload: any,
    threadId?: string,
  ) {
        const runId = randomUUID();

    // 1. Create tracking row before dispatch
        const run = await WorkflowRepo.createRun({
      id: runId,
      workflowId,
      workflowKey,
      provider: provider as WorkflowProvider,
      traceId,
      userId,
      threadId,
      triggerSource,
      inputPayload: payload || {},
      status: 'queued',
    });

    // Announce the new run to clients
    eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, run);
    if (threadId) {
      ContextService.indexAuditEvent({
        threadId,
        userId,
        workflowRunId: runId,
        workflowId,
        action: 'workflow_queued',
        summary: `Queued workflow ${workflowKey} via ${triggerSource}.`,
        metadata: { workflowKey, provider, triggerSource, runId, traceId },
      }).catch(() => {});
    }

    // 2. Dispatch through provider adapter (async — don't await)
    this.dispatchViaAdapter(runId, workflowId, workflowKey, provider as WorkflowProvider, executionEndpoint, userId, traceId, triggerSource, payload, threadId);

    return run;
  }

  /**
   * Create a workflow run parked in waiting_approval state without dispatching provider execution.
   * Used by the main agent guarded policy for medium/high-risk subagents.
   */
  static async createApprovalGateRun(input: {
        workflowId: string;
        workflowKey: string;
        provider: string;
        userId: string;
        traceId: string;
    threadId?: string;
        triggerSource: WorkflowTriggerSource;
    inputPayload?: Record<string, unknown>;
  }) {
        const runId = randomUUID();
        const run = await WorkflowRepo.createRun({
      id: runId,
      workflowId: input.workflowId,
      workflowKey: input.workflowKey,
      provider: input.provider as WorkflowProvider,
      traceId: input.traceId,
      userId: input.userId,
      threadId: input.threadId,
      triggerSource: input.triggerSource,
      inputPayload: input.inputPayload || {},
      status: 'waiting_approval',
    });
    eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, run);
    if (input.threadId) {
      ContextService.indexAuditEvent({
        threadId: input.threadId,
        userId: input.userId,
        workflowRunId: runId,
        workflowId: input.workflowId,
        action: 'workflow_waiting_approval',
        summary: `Workflow ${input.workflowKey} is waiting for approval.`,
        metadata: { workflowKey: input.workflowKey, provider: input.provider, triggerSource: input.triggerSource, runId, traceId: input.traceId },
      }).catch(() => {});
    }
    return run;
  }

  /**
   * Execute a workflow and await its completion.
   * Returns the final run record with status/output/errors.
   * Used by the orchestrator to produce result blocks in chat.
   */
  static async executeAndAwait(
    workflowId: string,
    workflowKey: string,
    provider: string,
    executionEndpoint: string,
    userId: string,
    traceId: string,
    triggerSource: WorkflowTriggerSource,
    payload: any,
    threadId?: string,
  ) {
        const runId = randomUUID();

    // 1. Create tracking row before dispatch
        const run = await WorkflowRepo.createRun({
      id: runId,
      workflowId,
      workflowKey,
      provider: provider as WorkflowProvider,
      traceId,
      userId,
      threadId,
      triggerSource,
      inputPayload: payload || {},
      status: 'queued',
    });

    eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, run);
    if (threadId) {
      ContextService.indexAuditEvent({
        threadId,
        userId,
        workflowRunId: runId,
        workflowId,
        action: 'workflow_queued',
        summary: `Queued workflow ${workflowKey} for awaited execution via ${triggerSource}.`,
        metadata: { workflowKey, provider, triggerSource, runId, traceId },
      }).catch(() => {});
    }

    // 2. Dispatch through provider adapter — AWAIT completion
    await this.dispatchViaAdapter(
      runId, workflowId, workflowKey, provider as WorkflowProvider,
      executionEndpoint, userId, traceId, triggerSource, payload, threadId,
    );

    // 3. Fetch the final run record with updated status/output
        const finalRun = await WorkflowRepo.getRunById(runId);
    return finalRun || run;
  }

  /**
   * Dispatch execution through the resolved provider adapter.
   */
  private static async dispatchViaAdapter(
    runId: string,
    workflowId: string,
    workflowKey: string,
    provider: WorkflowProvider,
    executionEndpoint: string,
    userId: string,
    traceId: string,
    triggerSource: WorkflowTriggerSource,
    payload: any,
    threadId?: string,
  ): Promise<void> {
    try {
      // Update status to running
      await WorkflowRepo.updateRunStatus(runId, 'running');
      eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, { id: runId, status: 'running' });
      eventBus.emit(EventTypes.WORKFLOW_TRIGGERED, { runId, workflowId, workflowKey, provider });
      if (threadId) {
        ContextService.indexAuditEvent({
          threadId,
          userId,
          workflowRunId: runId,
          workflowId,
          action: 'workflow_dispatched',
          summary: `Dispatched workflow ${workflowKey} to provider ${provider}.`,
          metadata: { workflowKey, provider, triggerSource, runId, traceId },
        }).catch(() => {});
      }

      // Resolve adapter
            const adapter = WorkflowProviderFactory.getAdapter(provider);

      // Build workflow object for adapter (need raw — not sanitized)
            const workflow = await WorkflowRepo.getWorkflowById(workflowId) as unknown as Workflow;
      if (!workflow) {
        throw new Error(`Workflow ${workflowId} not found during dispatch`);
      }

      // Build standard execution request
            const request: WorkflowExecutionRequest = {
        traceId,
        workflowKey,
        userId,
        source: triggerSource,
        input: payload || {},
        callbackUrl: `${CALLBACK_BASE_URL}/api/webhooks/callback`,
        meta: { runId, threadId },
      };

      // Trigger through adapter
            const result = await adapter.triggerWorkflow(workflow, request);

      // Update run with result
      if (result.status === 'failed') {
        await this.updateRunStatus(runId, 'failed', null, result.raw, result.error as any);
                const snapshot = await ContextService.persistWorkflowRunSnapshot({
          workflowRunId: runId,
          workflowKey,
          workflowName: workflow.name,
          provider: provider as string,
          status: 'failed',
          triggerSource: triggerSource as string,
          inputPayload: payload || {},
          rawProviderResponse: result.raw,
          errorPayload: result.error,
        });
        if (NotificationService.shouldNotifyWorkflowRun({ triggerSource, threadId })) {
          NotificationService.notify(userId, {
            type: 'workflow_event',
            title: `Workflow Failed: ${workflowKey}`,
            message: `Run ${runId.slice(0, 8)} failed during execution.`,
            runId,
          }).catch(() => {});
        }

        // Index failure into context memory
        ContextService.indexWorkflowRun({
          threadId,
          userId,
          workflowRunId: runId,
          workflowId,
          workflowKey,
          workflowName: workflow.name,
          provider: provider as string,
          traceId,
          triggerSource: triggerSource as string,
          status: 'failed',
          errorSummary: result.error?.error as string || result.error?.message as string || 'Unknown error',
          inputPayload: payload || {},
          rawProviderResponse: result.raw,
          errorPayload: result.error,
          snapshotPath: snapshot.path,
          snapshotBytes: snapshot.bytes,
          snapshotTokenEstimate: snapshot.tokenEstimate,
        }).catch(err => console.error('[WorkflowService] Context indexing failed:', err));
      } else {
        await this.updateRunStatus(runId, result.status, result.result, result.raw);
                const snapshot = await ContextService.persistWorkflowRunSnapshot({
          workflowRunId: runId,
          workflowKey,
          workflowName: workflow.name,
          provider: provider as string,
          status: result.status,
          triggerSource: triggerSource as string,
          inputPayload: payload || {},
          normalizedOutput: result.result,
          rawProviderResponse: result.raw,
        });
        if (NotificationService.shouldNotifyWorkflowRun({ triggerSource, threadId })) {
          NotificationService.notify(userId, {
            type: 'workflow_event',
            title: `Workflow Completed: ${workflowKey}`,
            message: `Run ${runId.slice(0, 8)} finished successfully.`,
            runId,
          }).catch(() => {});
        }

        // Index success into context memory
        ContextService.indexWorkflowRun({
          threadId,
          userId,
          workflowRunId: runId,
          workflowId,
          workflowKey,
          workflowName: workflow.name,
          provider: provider as string,
          traceId,
          triggerSource: triggerSource as string,
          status: result.status,
          resultSummary: result.result?.summary,
          resultData: result.result?.data ?? (result.result as Record<string, unknown> | null),
          inputPayload: payload || {},
          rawProviderResponse: result.raw,
          snapshotPath: snapshot.path,
          snapshotBytes: snapshot.bytes,
          snapshotTokenEstimate: snapshot.tokenEstimate,
        }).catch(err => console.error('[WorkflowService] Context indexing failed:', err));
      }

      // Update workflow's last-run
      WorkflowRepo.updateLastRun(workflowId, result.status).catch(() => {});
      if (threadId) {
        ContextService.indexAuditEvent({
          threadId,
          userId,
          workflowRunId: runId,
          workflowId,
                    action: result.status === 'failed' ? 'workflow_failed' : 'workflow_completed',
          summary: `Workflow ${workflowKey} finished with status ${result.status}.`,
          metadata: { workflowKey, provider, triggerSource, runId, traceId, status: result.status },
        }).catch(() => {});
      }

    } catch (err) {
      console.error(`[WorkflowService] Dispatch failed for run ${runId}:`, err);
            const errorPayload = { error: err instanceof Error ? err.message : String(err) };
      await this.updateRunStatus(runId, 'failed', undefined, undefined, errorPayload).catch(() => {});
      WorkflowRepo.updateLastRun(workflowId, 'failed').catch(() => {});
            const snapshot = await ContextService.persistWorkflowRunSnapshot({
        workflowRunId: runId,
        workflowKey,
        workflowName: workflowKey,
        provider: provider as string,
        status: 'failed',
        triggerSource: triggerSource as string,
        inputPayload: payload || {},
        errorPayload,
      }).catch(() => null);

      if (NotificationService.shouldNotifyWorkflowRun({ triggerSource, threadId })) {
        NotificationService.notify(userId, {
          type: 'workflow_event',
          title: `Workflow Dispatch Failed: ${workflowKey}`,
          message: `Run ${runId.slice(0, 8)} completely failed: ${errorPayload.error}`,
          runId,
        }).catch(() => {});
      }

      // Index dispatch failure into context memory
      ContextService.indexWorkflowRun({
        threadId,
        userId,
        workflowRunId: runId,
        workflowId,
        workflowKey,
        workflowName: workflowKey, // name not available at this point
        provider: provider as string,
        traceId,
        triggerSource: triggerSource as string,
        status: 'failed',
        errorSummary: errorPayload.error,
        inputPayload: payload || {},
        errorPayload,
        snapshotPath: snapshot?.path,
        snapshotBytes: snapshot?.bytes,
        snapshotTokenEstimate: snapshot?.tokenEstimate,
      }).catch(err => console.error('[WorkflowService] Context indexing failed:', err));
      if (threadId) {
        ContextService.indexAuditEvent({
          threadId,
          userId,
          workflowRunId: runId,
          workflowId,
          action: 'workflow_dispatch_failed',
          summary: `Workflow ${workflowKey} dispatch failed: ${errorPayload.error}`,
          metadata: { workflowKey, provider, triggerSource, runId, traceId, status: 'failed' },
        }).catch(() => {});
      }
    }
  }

  // ── Run management ───────────────────────────────────────────

  static async updateRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    normalizedOutput?: any,
    rawProviderResponse?: any,
    errorPayload?: any,
  ) {
        const run = await WorkflowRepo.updateRunStatus(
      runId, status, normalizedOutput, rawProviderResponse, errorPayload,
    );
    eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, run);
    return run;
  }

  /** Validate a workflow's configuration against its provider adapter */
  static async validateWorkflowConfig(workflowId: string) {
        const workflow = await WorkflowRepo.getWorkflowById(workflowId) as unknown as Workflow;
    if (!workflow) {
      return { valid: false, errors: ['Workflow not found'], warnings: [] };
    }
        const adapter = WorkflowProviderFactory.getAdapter(workflow.provider);
    return adapter.validateConfig(workflow);
  }

    static async validateWorkflowConfigForUser(workflowId: string, userId: string) {
        const existing = await this.getById(workflowId, userId);
    if (!existing) return null;
    return this.validateWorkflowConfig(workflowId);
  }

    static async getRunsByWorkflowId(workflowId: string, limit = 50, before?: string) {
    return WorkflowRepo.getRunsByWorkflowId(workflowId, limit, before);
  }

    static async getRunById(runId: string) {
    return WorkflowRepo.getRunById(runId);
  }

    static async getRunByTraceId(traceId: string) {
    return WorkflowRepo.getRunByTraceId(traceId);
  }

  /**
   * Create a run record for externally-originated callbacks that did not come
   * through this application's trigger path (no app traceId available).
   */
  static async createExternalCallbackRun(params: {
        workflowKey: string;
        provider: string;
    userId?: string;
    traceId?: string;
    triggerSource?: WorkflowTriggerSource;
  }) {
        const workflow = await WorkflowRepo.getWorkflowByKey(params.workflowKey);
    if (!workflow) return null;
        const resolvedUserId =
      params.userId
      || workflow.ownerUserId
      || (await UserRepo.getAnyPrimaryUser())?.id;
    if (!resolvedUserId) return null;

        const run = await WorkflowRepo.createRun({
      id: randomUUID(),
      workflowId: workflow.id,
      workflowKey: workflow.key,
      provider: (params.provider as WorkflowProvider) || (workflow.provider as WorkflowProvider),
      traceId: params.traceId?.trim() || randomUUID(),
      userId: resolvedUserId,
      triggerSource: params.triggerSource ?? 'system',
      inputPayload: {},
      status: 'running',
    });

    eventBus.emit(EventTypes.WORKFLOW_RUN_UPDATED, run);
    return run;
  }
}
