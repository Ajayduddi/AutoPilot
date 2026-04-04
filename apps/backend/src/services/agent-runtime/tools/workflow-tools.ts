/**
 * @fileoverview services/agent-runtime/tools/workflow-tools.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { WorkflowService } from "../../workflow.service";
import type { AgentToolMap, AgentToolRuntimeContext } from "../types";
import {
  createApprovalGateRunShared,
  executeWorkflowAwaitShared,
  resolveExecutableWorkflow,
  triggerWorkflowAsyncShared,
} from "../workflow-execution.service";

const jsonRecordSchema = z.record(z.string(), z.unknown()).default({});

function trimString(value: unknown): string {
  return String(value || "").trim();
}

function isTerminalWorkflowStatus(status: unknown): boolean {
    const value = String(status || "").trim().toLowerCase();
  return value === "completed" || value === "failed" || value === "waiting_approval";
}

/**
 * createWorkflowTools function.
 *
 * Performs create workflow tools logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function createWorkflowTools(ctx: AgentToolRuntimeContext): AgentToolMap {
    const executionCtx = {
    userId: ctx.userId,
    traceId: ctx.traceId,
    threadId: ctx.threadId,
  };
    const searchWorkflows = createTool({
    id: "search_workflows",
    description:
      "Search available workflows/subagents by keyword. Use this before triggering workflows.",
    inputSchema: z.object({
      query: z.string().min(1),
      provider: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(5),
    }),
        execute: async ({ query, provider, limit }) => {
            const rows = await WorkflowService.listAccessible(ctx.userId, {
        search: query,
        provider: provider as any,
        archived: false,
      });
      return {
        count: rows.length,
                items: rows.slice(0, limit).map((wf: any) => ({
          id: wf.id,
          key: wf.key,
          name: wf.name,
          provider: wf.provider,
          enabled: wf.enabled,
          requiresApproval: wf.requiresApproval,
          description: wf.description || "",
        })),
      };
    },
  });

    const getWorkflowDetails = createTool({
    id: "get_workflow_details",
    description:
      "Get details for a workflow by workflow ID or workflow key. Returns null when inaccessible.",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowKey: z.string().optional(),
    }),
        execute: async ({ workflowId, workflowKey }) => {
            const resolution = await resolveExecutableWorkflow(executionCtx, { workflowId, workflowKey });
      if (!resolution.ok) return { found: false, reason: resolution.error };
            const wf = resolution.workflow;

      return {
        found: true,
        workflow: {
          id: (wf as any).id,
          key: (wf as any).key,
          name: (wf as any).name,
          provider: (wf as any).provider,
          enabled: (wf as any).enabled,
          archived: (wf as any).archived,
          requiresApproval: (wf as any).requiresApproval,
          executionEndpoint: (wf as any).executionEndpoint,
          description: (wf as any).description || "",
          tags: Array.isArray((wf as any).tags) ? (wf as any).tags : [],
        },
      };
    },
  });

    const triggerWorkflow = createTool({
    id: "trigger_workflow",
    description:
      "Trigger a workflow/subagent by ID or key and wait for completion. Use only when execution is explicitly needed.",
        requireApproval: ctx.approvalMode !== "auto",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowKey: z.string().optional(),
      input: jsonRecordSchema,
      threadId: z.string().optional(),
    }),
        execute: async ({ workflowId, workflowKey, input, threadId }) => {
            const resolution = await resolveExecutableWorkflow(executionCtx, { workflowId, workflowKey });
      if (!resolution.ok) return { ok: false, error: resolution.error, code: resolution.code };

            const run = await executeWorkflowAwaitShared({
        ctx: executionCtx,
        workflow: resolution.workflow,
        payload: input || {},
        threadId,
      });

      return {
        ok: true,
        run: {
          id: run.id,
          workflowId: run.workflowId,
          workflowKey: run.workflowKey,
          status: run.status,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          output: run.normalizedOutput,
          error: run.errorPayload,
        },
      };
    },
  });

    const triggerWorkflowAsync = createTool({
    id: "trigger_workflow_async",
    description:
      "Trigger a workflow/subagent without waiting for completion. Prefer this for longer jobs, then observe with get_workflow_run or wait_for_workflow_run.",
        requireApproval: ctx.approvalMode !== "auto",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowKey: z.string().optional(),
      input: jsonRecordSchema,
      threadId: z.string().optional(),
    }),
        execute: async ({ workflowId, workflowKey, input, threadId }) => {
            const resolution = await resolveExecutableWorkflow(executionCtx, { workflowId, workflowKey });
      if (!resolution.ok) return { ok: false, error: resolution.error, code: resolution.code };

            const run = await triggerWorkflowAsyncShared({
        ctx: executionCtx,
        workflow: resolution.workflow,
        payload: input || {},
        threadId,
      });

      return {
        ok: true,
        run: {
          id: run.id,
          workflowId: run.workflowId,
          workflowKey: run.workflowKey,
          status: run.status,
          startedAt: run.startedAt,
        },
      };
    },
  });

    const createApprovalGateRun = createTool({
    id: "create_approval_gate_run",
    description:
      "Create a workflow run in waiting-approval state without executing it yet. Use when the plan is clear but approval is required.",
        requireApproval: ctx.approvalMode !== "auto",
    inputSchema: z.object({
      workflowId: z.string().optional(),
      workflowKey: z.string().optional(),
      input: jsonRecordSchema,
      threadId: z.string().optional(),
    }),
        execute: async ({ workflowId, workflowKey, input, threadId }) => {
            const resolution = await resolveExecutableWorkflow(executionCtx, { workflowId, workflowKey });
      if (!resolution.ok) return { ok: false, error: resolution.error, code: resolution.code };

            const run = await createApprovalGateRunShared({
        ctx: executionCtx,
        workflow: resolution.workflow,
        payload: input || {},
        threadId,
      });

      return {
        ok: true,
        run: {
          id: run.id,
          workflowId: run.workflowId,
          workflowKey: run.workflowKey,
          status: run.status,
          startedAt: run.startedAt,
        },
      };
    },
  });

    const getWorkflowRun = createTool({
    id: "get_workflow_run",
    description: "Get a workflow run by run ID (scoped to current user).",
    inputSchema: z.object({
      runId: z.string().min(1),
    }),
        execute: async ({ runId }) => {
            const run = await WorkflowService.getRunById(runId);
      if (!run || run.userId !== ctx.userId) {
        return { found: false };
      }
      return {
        found: true,
        run: {
          id: run.id,
          workflowId: run.workflowId,
          workflowKey: run.workflowKey,
          status: run.status,
          triggerSource: run.triggerSource,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          output: run.normalizedOutput,
          error: run.errorPayload,
        },
      };
    },
  });

    const listRecentRuns = createTool({
    id: "list_recent_runs",
    description: "List recent runs for a workflow (scoped to current user).",
    inputSchema: z.object({
      workflowId: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }),
        execute: async ({ workflowId, limit }) => {
            const wf = await WorkflowService.getById(workflowId, ctx.userId);
      if (!wf) return { count: 0, items: [], error: "Workflow not found" };
            const runs = await WorkflowService.getRunsByWorkflowId(workflowId, limit);
            const items = runs
        .filter((run) => run.userId === ctx.userId)
        .map((run) => ({
          id: run.id,
          status: run.status,
          traceId: run.traceId,
          triggerSource: run.triggerSource,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        }));
      return { count: items.length, items };
    },
  });

    const waitForWorkflowRun = createTool({
    id: "wait_for_workflow_run",
    description:
      "Poll a workflow run until it reaches a terminal state or times out. Use after trigger_workflow_async.",
    inputSchema: z.object({
      runId: z.string().min(1),
      timeoutMs: z.number().int().min(250).max(60000).default(15000),
      pollMs: z.number().int().min(100).max(5000).default(750),
    }),
        execute: async ({ runId, timeoutMs = 15000, pollMs = 750 }) => {
            const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
                const run = await WorkflowService.getRunById(runId);
        if (!run || run.userId !== ctx.userId) {
          return { ok: false, error: "Workflow run not found" };
        }
        if (isTerminalWorkflowStatus(run.status)) {
          return {
            ok: true,
            terminal: true,
            run: {
              id: run.id,
              workflowId: run.workflowId,
              workflowKey: run.workflowKey,
              status: run.status,
              triggerSource: run.triggerSource,
              startedAt: run.startedAt,
              finishedAt: run.finishedAt,
              output: run.normalizedOutput,
              error: run.errorPayload,
            },
          };
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

            const latest = await WorkflowService.getRunById(runId);
      if (!latest || latest.userId !== ctx.userId) {
        return { ok: false, error: "Workflow run not found" };
      }
      return {
        ok: true,
        terminal: false,
        run: {
          id: latest.id,
          workflowId: latest.workflowId,
          workflowKey: latest.workflowKey,
          status: latest.status,
          triggerSource: latest.triggerSource,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          output: latest.normalizedOutput,
          error: latest.errorPayload,
        },
      };
    },
  });

  return {
    searchWorkflows,
    getWorkflowDetails,
    triggerWorkflow,
    triggerWorkflowAsync,
    createApprovalGateRun,
    getWorkflowRun,
    listRecentRuns,
    waitForWorkflowRun,
  };
}
