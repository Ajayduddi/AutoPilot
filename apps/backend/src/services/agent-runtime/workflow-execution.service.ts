/**
 * @fileoverview services/agent-runtime/workflow-execution.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { WorkflowService } from "../workflow.service";

type WorkflowTriggerSource = "system" | "api" | "ui" | "chat" | "assistant_action";

type WorkflowAccessContext = {
    userId: string;
    traceId: string;
    threadId: string;
};

type WorkflowLookupInput = {
  workflowId?: string;
  workflowKey?: string;
};

type ExecutableWorkflow = {
    id: string;
    key: string;
    name: string;
    provider: string;
    enabled: boolean;
    archived: boolean;
    executionEndpoint: string | null;
  requiresApproval?: boolean;
};

type WorkflowResolution =
  | { ok: true; workflow: ExecutableWorkflow }
  | { ok: false; error: string; code: string };

function trimString(value: unknown): string {
  return String(value || "").trim();
}

function normalizeTriggerSource(value: WorkflowTriggerSource | undefined): WorkflowTriggerSource {
  return value || "assistant_action";
}

/**
 * resolveExecutableWorkflow function.
 *
 * Performs resolve executable workflow logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export async function resolveExecutableWorkflow(
  ctx: WorkflowAccessContext,
  input: WorkflowLookupInput,
): Promise<WorkflowResolution> {
    const workflowId = trimString(input.workflowId);
    const workflowKey = trimString(input.workflowKey);
  if (!workflowId && !workflowKey) {
    return { ok: false, error: "workflowId or workflowKey is required", code: "WORKFLOW_ID_OR_KEY_REQUIRED" };
  }

    const wf = workflowId
    ? await WorkflowService.getById(workflowId, ctx.userId)
    : await WorkflowService.getByKey(workflowKey, ctx.userId);
  if (!wf) {
    return { ok: false, error: "Workflow not found or not accessible", code: "WORKFLOW_NOT_FOUND" };
  }
  if (!(wf as any).enabled || (wf as any).archived) {
    return { ok: false, error: "Workflow is disabled or archived", code: "WORKFLOW_DISABLED" };
  }
  if (!(wf as any).executionEndpoint) {
    return { ok: false, error: "Workflow has no execution endpoint configured", code: "NO_ENDPOINT" };
  }

  return {
    ok: true,
    workflow: {
      id: (wf as any).id,
      key: (wf as any).key,
      name: (wf as any).name,
      provider: (wf as any).provider,
      enabled: (wf as any).enabled,
      archived: (wf as any).archived,
      executionEndpoint: (wf as any).executionEndpoint,
      requiresApproval: (wf as any).requiresApproval,
    },
  };
}

/**
 * executeWorkflowAwaitShared function.
 *
 * Performs execute workflow await shared logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export async function executeWorkflowAwaitShared(input: {
    ctx: WorkflowAccessContext;
    workflow: ExecutableWorkflow;
    payload: Record<string, unknown>;
  threadId?: string;
  triggerSource?: WorkflowTriggerSource;
}) {
    const effectiveThreadId = trimString(input.threadId) || input.ctx.threadId;
  return WorkflowService.executeAndAwait(
    input.workflow.id,
    input.workflow.key,
    input.workflow.provider,
    input.workflow.executionEndpoint as string,
    input.ctx.userId,
    input.ctx.traceId,
    normalizeTriggerSource(input.triggerSource),
    input.payload || {},
    effectiveThreadId,
  );
}

/**
 * triggerWorkflowAsyncShared function.
 *
 * Performs trigger workflow async shared logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export async function triggerWorkflowAsyncShared(input: {
    ctx: WorkflowAccessContext;
    workflow: ExecutableWorkflow;
    payload: Record<string, unknown>;
  threadId?: string;
  triggerSource?: WorkflowTriggerSource;
}) {
    const effectiveThreadId = trimString(input.threadId) || input.ctx.threadId;
  return WorkflowService.execute(
    input.workflow.id,
    input.workflow.key,
    input.workflow.provider,
    input.workflow.executionEndpoint as string,
    input.ctx.userId,
    input.ctx.traceId,
    normalizeTriggerSource(input.triggerSource),
    input.payload || {},
    effectiveThreadId,
  );
}

/**
 * createApprovalGateRunShared function.
 *
 * Performs create approval gate run shared logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export async function createApprovalGateRunShared(input: {
    ctx: WorkflowAccessContext;
    workflow: ExecutableWorkflow;
    payload: Record<string, unknown>;
  threadId?: string;
  triggerSource?: WorkflowTriggerSource;
}) {
    const effectiveThreadId = trimString(input.threadId) || input.ctx.threadId;
  return WorkflowService.createApprovalGateRun({
    workflowId: input.workflow.id,
    workflowKey: input.workflow.key,
    provider: input.workflow.provider,
    userId: input.ctx.userId,
    traceId: input.ctx.traceId,
    threadId: effectiveThreadId,
    triggerSource: normalizeTriggerSource(input.triggerSource),
    inputPayload: input.payload || {},
  });
}
