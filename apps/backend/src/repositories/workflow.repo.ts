import { eq, and, desc, ilike, inArray, SQL } from 'drizzle-orm';
import { db } from '../db';
import { workflows, workflowRuns } from '../db/schema';
import type {
  WorkflowProvider,
  WorkflowVisibility,
  WorkflowRunStatus,
  WorkflowTriggerSource,
} from '@chat-automation/shared';

// ─────────────────────────────────────────────────────────────
//  Types for repo inputs
// ─────────────────────────────────────────────────────────────

export interface CreateWorkflowInput {
  id: string;
  key: string;
  name: string;
  description?: string;
  provider?: WorkflowProvider;
  visibility?: WorkflowVisibility;
  ownerUserId?: string;
  enabled?: boolean;
  archived?: boolean;
  requiresApproval?: boolean;
  triggerMethod?: 'webhook' | 'api' | 'internal';
  executionEndpoint?: string;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  authType?: 'none' | 'bearer' | 'api_key' | 'header_secret' | 'custom';
  authConfig?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
  metadata?: Record<string, unknown>;
  version?: number;
}

export interface UpdateWorkflowInput {
  key?: string;
  name?: string;
  description?: string | null;
  provider?: WorkflowProvider;
  visibility?: WorkflowVisibility;
  enabled?: boolean;
  archived?: boolean;
  requiresApproval?: boolean;
  triggerMethod?: 'webhook' | 'api' | 'internal';
  executionEndpoint?: string | null;
  httpMethod?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  authType?: 'none' | 'bearer' | 'api_key' | 'header_secret' | 'custom';
  authConfig?: Record<string, unknown> | null;
  inputSchema?: Record<string, unknown> | null;
  outputSchema?: Record<string, unknown> | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  version?: number;
}

export interface CreateRunInput {
  id: string;
  workflowId: string;
  workflowKey: string;
  provider: WorkflowProvider;
  traceId: string;
  userId: string;
  threadId?: string;
  triggerSource: WorkflowTriggerSource;
  inputPayload?: Record<string, unknown>;
  status?: WorkflowRunStatus;
}

export interface WorkflowFilterOptions {
  provider?: WorkflowProvider;
  visibility?: WorkflowVisibility;
  enabled?: boolean;
  archived?: boolean;
  search?: string;
  tags?: string[];
}

// ─────────────────────────────────────────────────────────────
//  Repository
// ─────────────────────────────────────────────────────────────

export const WorkflowRepo = {
  // ── Workflow CRUD ────────────────────────────────────────────

  async createWorkflow(data: CreateWorkflowInput) {
    const [workflow] = await db.insert(workflows).values({
      ...data,
      tags: data.tags ?? [],
    }).returning();
    return workflow;
  },

  /** Upsert by key — backward-compatible with old registerWorkflow usage */
  async registerWorkflow(data: CreateWorkflowInput) {
    const [workflow] = await db.insert(workflows).values({
      ...data,
      tags: data.tags ?? [],
    })
      .onConflictDoUpdate({
        target: workflows.key,
        set: {
          name: data.name,
          description: data.description,
          provider: data.provider,
          visibility: data.visibility,
          enabled: data.enabled,
          requiresApproval: data.requiresApproval,
          triggerMethod: data.triggerMethod,
          executionEndpoint: data.executionEndpoint,
          authType: data.authType,
          authConfig: data.authConfig,
          inputSchema: data.inputSchema,
          outputSchema: data.outputSchema,
          tags: data.tags ?? [],
          metadata: data.metadata,
          updatedAt: new Date(),
        },
      })
      .returning();
    return workflow;
  },

  async getWorkflowById(id: string) {
    return await db.query.workflows.findFirst({
      where: eq(workflows.id, id),
    });
  },

  async getWorkflowByKey(key: string) {
    return await db.query.workflows.findFirst({
      where: eq(workflows.key, key),
    });
  },

  async getAllWorkflows(filters?: WorkflowFilterOptions) {
    const conditions: SQL[] = [];

    if (filters?.provider) {
      conditions.push(eq(workflows.provider, filters.provider));
    }
    if (filters?.visibility) {
      conditions.push(eq(workflows.visibility, filters.visibility));
    }
    if (filters?.enabled !== undefined) {
      conditions.push(eq(workflows.enabled, filters.enabled));
    }
    if (filters?.archived !== undefined) {
      conditions.push(eq(workflows.archived, filters.archived));
    }
    if (filters?.search) {
      conditions.push(ilike(workflows.name, `%${filters.search}%`));
    }

    if (conditions.length === 0) {
      return await db.query.workflows.findMany({
        orderBy: desc(workflows.updatedAt),
      });
    }

    return await db.query.workflows.findMany({
      where: and(...conditions),
      orderBy: desc(workflows.updatedAt),
    });
  },

  /** Backward-compatible: list only enabled, non-archived workflows */
  async getAllEnabledWorkflows() {
    return this.getAllWorkflows({ enabled: true, archived: false });
  },

  async updateWorkflow(id: string, data: UpdateWorkflowInput) {
    const [workflow] = await db.update(workflows)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(workflows.id, id))
      .returning();
    return workflow;
  },

  async archiveWorkflow(id: string) {
    return this.updateWorkflow(id, { archived: true, enabled: false });
  },

  async deleteWorkflow(id: string) {
    const [workflow] = await db.delete(workflows)
      .where(eq(workflows.id, id))
      .returning();
    return workflow;
  },

  /** Update last run info on the workflow row */
  async updateLastRun(workflowId: string, status: WorkflowRunStatus) {
    await db.update(workflows)
      .set({ lastRunAt: new Date(), lastRunStatus: status, updatedAt: new Date() })
      .where(eq(workflows.id, workflowId));
  },

  // ── Workflow Runs ────────────────────────────────────────────

  async createRun(data: CreateRunInput) {
    const [run] = await db.insert(workflowRuns).values({
      ...data,
      status: data.status ?? 'queued',
    }).returning();
    return run;
  },

  async getRunById(runId: string) {
    return await db.query.workflowRuns.findFirst({
      where: eq(workflowRuns.id, runId),
    });
  },

  async getRunByTraceId(traceId: string) {
    return await db.query.workflowRuns.findFirst({
      where: eq(workflowRuns.traceId, traceId),
    });
  },

  async getRunsByWorkflowId(workflowId: string, limit = 50) {
    return await db.query.workflowRuns.findMany({
      where: eq(workflowRuns.workflowId, workflowId),
      orderBy: desc(workflowRuns.createdAt),
      limit,
    });
  },

  async updateRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    normalizedOutput?: any,
    rawProviderResponse?: any,
    errorPayload?: any,
  ) {
    const updateData: any = { status, updatedAt: new Date() };
    if (normalizedOutput !== undefined) updateData.normalizedOutput = normalizedOutput;
    if (rawProviderResponse !== undefined) updateData.rawProviderResponse = rawProviderResponse;
    if (errorPayload !== undefined) updateData.errorPayload = errorPayload;
    if (status === 'completed' || status === 'failed') {
      updateData.finishedAt = new Date();
    }
    const [run] = await db.update(workflowRuns)
      .set(updateData)
      .where(eq(workflowRuns.id, runId))
      .returning();
    return run;
  },
};
