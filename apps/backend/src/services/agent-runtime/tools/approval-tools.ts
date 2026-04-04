/**
 * @fileoverview services/agent-runtime/tools/approval-tools.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { ApprovalService } from "../../approval.service";
import type { AgentToolMap, AgentToolRuntimeContext } from "../types";

/**
 * createApprovalTools function.
 *
 * Performs create approval tools logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function createApprovalTools(ctx: AgentToolRuntimeContext): AgentToolMap {
    const createApproval = createTool({
    id: "create_approval",
    description:
      "Create an approval request for a workflow run when high-risk actions require user confirmation.",
    inputSchema: z.object({
      runId: z.string().min(1),
      summary: z.string().min(3),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
        execute: async ({ runId, summary, details }) => {
            const approval = await ApprovalService.request(
        runId,
        ctx.userId,
        summary,
        details || {},
        { type: "user", id: ctx.userId },
      );
      return {
        ok: true,
        approval: {
          id: approval.id,
          runId: approval.runId,
          status: approval.status,
          summary: approval.summary,
          createdAt: approval.createdAt,
        },
      };
    },
  });

    const getPendingApprovals = createTool({
    id: "get_pending_approvals",
    description: "List pending approval requests for the current user.",
    inputSchema: z.object({}).default({}),
        execute: async () => {
            const approvals = await ApprovalService.getPending(ctx.userId);
      return {
        count: approvals.length,
                items: approvals.map((a) => ({
          id: a.id,
          runId: a.runId,
          status: a.status,
          summary: a.summary,
          createdAt: a.createdAt,
        })),
      };
    },
  });

    const resolveApproval = createTool({
    id: "resolve_approval",
    description: "Resolve a pending approval by approving or rejecting it.",
        requireApproval: ctx.approvalMode !== "auto",
    inputSchema: z.object({
      approvalId: z.string().min(1),
      action: z.enum(["approved", "rejected"]),
    }),
        execute: async ({ approvalId, action }) => {
            const approval = await ApprovalService.resolve(approvalId, ctx.userId, action);
      if (!approval) {
        return { ok: false, error: "Approval not found or already resolved" };
      }
      return {
        ok: true,
        approval: {
          id: approval.id,
          runId: approval.runId,
          status: approval.status,
          resolvedAt: approval.resolvedAt,
        },
      };
    },
  });

  return {
    createApproval,
    getPendingApprovals,
    resolveApproval,
  };
}
