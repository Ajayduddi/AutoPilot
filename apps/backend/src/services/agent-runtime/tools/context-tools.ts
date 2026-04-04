/**
 * @fileoverview services/agent-runtime/tools/context-tools.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import { ContextService } from "../../context.service";
import { ChatRepo } from "../../../repositories/chat.repo";
import type { ContextItem } from "../../../repositories/context.repo";
import type { AgentToolMap, AgentToolRuntimeContext } from "../types";

function safeThreadId(runtime: AgentToolRuntimeContext, requested?: string): string {
    const candidate = String(requested || "").trim();
  return candidate || runtime.threadId;
}

/**
 * createContextTools function.
 *
 * Performs create context tools logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function createContextTools(ctx: AgentToolRuntimeContext): AgentToolMap {
    const resolveWorkflowContextItem = async (args: { threadId?: string; contextItemId?: string; runId?: string }): Promise<ContextItem | null> => {
        const targetThreadId = safeThreadId(ctx, args.threadId);
        const items = await ContextService.getThreadContext(targetThreadId, {
      limit: 20,
      categories: ["workflow_run"],
    });
    if (args.contextItemId) {
      return items.find((item) => item.id === args.contextItemId) || null;
    }
    if (args.runId) {
      return items.find((item) => {
                const meta = (item.metadata as Record<string, unknown> | null) || {};
        return meta.runId === args.runId || item.workflowRunId === args.runId;
      }) || null;
    }
    return items[0] || null;
  };

    const getRecentThreadContext = createTool({
    id: "get_recent_thread_context",
    description:
      "Retrieve recent thread context memory entries (thread state, decisions, and workflow context).",
    inputSchema: z.object({
      threadId: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
        execute: async ({ threadId, limit }) => {
            const targetThreadId = safeThreadId(ctx, threadId);
            const items = await ContextService.getThreadContext(targetThreadId, {
        limit,
        categories: ["thread_state", "assistant_decision", "workflow_run"],
      });
      return {
        count: items.length,
                items: items.map((item) => ({
          id: item.id,
          category: item.category,
          summary: item.summary,
          content: item.content,
          metadata: item.metadata,
          createdAt: item.createdAt,
        })),
      };
    },
  });

    const getRecentWorkflowContext = createTool({
    id: "get_recent_workflow_context",
    description: "Retrieve recent workflow-run context entries from thread memory.",
    inputSchema: z.object({
      threadId: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(8),
    }),
        execute: async ({ threadId, limit }) => {
            const targetThreadId = safeThreadId(ctx, threadId);
            const items = await ContextService.getThreadContext(targetThreadId, {
        limit,
        categories: ["workflow_run"],
      });
      return {
        count: items.length,
        formatted: ContextService.formatForPrompt(items),
                items: items.map((item) => ({
          id: item.id,
          summary: item.summary,
          metadata: item.metadata,
          createdAt: item.createdAt,
        })),
      };
    },
  });

    const getAttachmentContext = createTool({
    id: "get_attachment_context",
    description: "Retrieve recent attachment summaries and chunks from the current thread.",
    inputSchema: z.object({
      threadId: z.string().optional(),
      limitFiles: z.number().int().min(1).max(10).default(5),
      limitChunksPerFile: z.number().int().min(1).max(12).default(4),
    }),
        execute: async ({ threadId, limitFiles = 5, limitChunksPerFile = 4 }) => {
            const targetThreadId = safeThreadId(ctx, threadId);
            const attachments = await ChatRepo.listAttachmentsByThread(targetThreadId);
            const owned = attachments.filter((a) => a.userId === ctx.userId).slice(-limitFiles);
            const chunks = await ChatRepo.getAttachmentChunksByAttachmentIds(
        owned.map((a) => a.id),
        { limitPerAttachment: limitChunksPerFile },
      );
            const chunkByAttachment = new Map<string, string[]>();
      for (const chunk of chunks) {
                const arr = chunkByAttachment.get(chunk.attachmentId) || [];
        arr.push(chunk.content);
        chunkByAttachment.set(chunk.attachmentId, arr);
      }
      return {
        count: owned.length,
                items: owned.map((a) => ({
          id: a.id,
          filename: a.filename,
          mimeType: a.mimeType,
          processingStatus: a.processingStatus,
          extractedText: (a.extractedText || "").slice(0, 1400),
          previewData: a.previewData || null,
          structuredMetadata: a.structuredMetadata || null,
          chunks: chunkByAttachment.get(a.id) || [],
        })),
      };
    },
  });

    const findRelevantWorkflowRuns = createTool({
    id: "find_relevant_workflow_runs",
    description:
      "Find the most relevant workflow runs for the current question, ranked by workflow match, original question match, and recency.",
    inputSchema: z.object({
      threadId: z.string().optional(),
      question: z.string().min(1),
      limit: z.number().int().min(1).max(8).default(5),
      preferredWorkflowKey: z.string().optional(),
    }),
        execute: async ({ threadId, question, limit, preferredWorkflowKey }) => {
            const targetThreadId = safeThreadId(ctx, threadId);
            const matches = await ContextService.findRelevantWorkflowRuns(targetThreadId, question, {
        limit,
        preferredWorkflowKey,
      });
      return {
        count: matches.length,
                items: matches.map((match) => ({
          contextItemId: match.item.id,
          runId: match.runId,
          workflowKey: match.workflowKey,
          workflowName: match.workflowName,
          score: match.score,
          matchedTerms: match.matchedTerms,
          originalQuestion: match.originalQuestion || null,
          summary: match.item.summary,
          createdAt: match.item.createdAt,
        })),
      };
    },
  });

    const load_complete_workflow_cache = createTool({
    id: "load_complete_workflow_cache",
    description:
      "Load the full preserved cache for a workflow run. Prefer this when the question depends on exact workflow output, not a summarized thread context.",
    inputSchema: z.object({
      threadId: z.string().optional(),
      contextItemId: z.string().optional(),
      runId: z.string().optional(),
    }),
        execute: async ({ threadId, contextItemId, runId }) => {
            const item = await resolveWorkflowContextItem({ threadId, contextItemId, runId });
      if (!item) {
        return { ok: false, error: "Workflow run context not found in this thread." };
      }
            const fullCache = await ContextService.loadCompleteWorkflowCache(item);
            const meta = (item.metadata as Record<string, unknown> | null) || {};
      return {
        ok: true,
        contextItemId: item.id,
        runId: String(meta.runId || item.workflowRunId || ""),
        workflowKey: String(meta.workflowKey || ""),
        workflowName: String(meta.workflowName || meta.workflowKey || "workflow"),
        cacheText: fullCache,
      };
    },
  });

    const extract_workflow_run_fields = createTool({
    id: "extract_workflow_run_fields",
    description:
      "Extract specific named fields from a workflow run. Use this when you need exact values without loading the entire cache into the prompt.",
    inputSchema: z.object({
      threadId: z.string().optional(),
      contextItemId: z.string().optional(),
      runId: z.string().optional(),
      fields: z.array(z.string().min(1)).min(1).max(12),
    }),
        execute: async ({ threadId, contextItemId, runId, fields }) => {
            const item = await resolveWorkflowContextItem({ threadId, contextItemId, runId });
      if (!item) {
        return { ok: false, error: "Workflow run context not found in this thread." };
      }
            const extracted = await ContextService.extractWorkflowRunFields(item, fields);
            const meta = (item.metadata as Record<string, unknown> | null) || {};
      return {
        ok: true,
        contextItemId: item.id,
        runId: String(meta.runId || item.workflowRunId || ""),
        workflowKey: String(meta.workflowKey || ""),
        workflowName: String(meta.workflowName || meta.workflowKey || "workflow"),
        source: extracted.source,
        values: extracted.values,
        missing: extracted.missing,
      };
    },
  });

  return {
    getRecentThreadContext,
    getRecentWorkflowContext,
    getAttachmentContext,
    findRelevantWorkflowRuns,
    load_complete_workflow_cache,
    extract_workflow_run_fields,
  };
}
