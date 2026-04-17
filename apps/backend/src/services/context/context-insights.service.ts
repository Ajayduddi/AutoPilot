/**
 * @fileoverview apps/backend/src/services/context/context-insights.service.ts
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { type ContextCategory } from "../../repositories/context.repo";
import { ContextRepo } from "../../repositories/context.repo";
import { EmbeddingRepo } from "../../repositories/embedding.repo";
import { logger } from "../../util/logger";
import type {
  ThreadMemoryInsight,
  ThreadMemoryInsightOptions,
  ThreadMemoryInsightSummary,
} from "./context.types";

const categoryOrder: ContextCategory[] = ["thread_state", "workflow_run", "chat_summary", "assistant_decision", "audit_event"];

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

export class ContextInsightsService {
  static async listThreadMemoryInsightsSummary(
    threadId: string,
    options: ThreadMemoryInsightOptions = {},
    getThreadContext: (threadId: string, options?: { limit?: number; categories?: ContextCategory[] }) => Promise<any[]>,
  ): Promise<ThreadMemoryInsightSummary> {
    try {
      const limit = Math.max(1, Math.min(200, Number(options.limit || 40)));
      const category = options.category && options.category !== "all" ? options.category : null;
      const groupBy = options.groupBy === "category" ? "category" : "none";
      const [items, groupedCounts] = await Promise.all([
        category
          ? ContextRepo.getByThreadAndCategory(threadId, category, limit)
          : getThreadContext(threadId, { limit }),
        ContextRepo.getThreadCategoryCounts(threadId),
      ]);

      const chatSummaryIds = items.filter((item) => item.category === "chat_summary").map((item) => item.id);
      const workflowRunIds = items
        .filter((item) => item.category === "workflow_run" && item.workflowRunId)
        .map((item) => String(item.workflowRunId));

      const [chatSummaryEmbeddings, workflowRunEmbeddings] = await Promise.all([
        EmbeddingRepo.findBySourceIds("chat_summary", chatSummaryIds),
        EmbeddingRepo.findBySourceIds("workflow_run", workflowRunIds),
      ]);
      const chatSummarySet = new Set(chatSummaryEmbeddings.map((item) => item.sourceId));
      const workflowRunSet = new Set(workflowRunEmbeddings.map((item) => item.sourceId));

      const mapped = items.map((item) => {
        const metadata = (item.metadata as Record<string, unknown> | null) || {};
        const entityKeys = Array.isArray(metadata.entityKeys)
          ? metadata.entityKeys.map((value) => String(value || "").trim()).filter(Boolean)
          : [];
        const hasEmbedding = item.category === "chat_summary"
          ? chatSummarySet.has(item.id)
          : item.category === "workflow_run"
            ? workflowRunSet.has(String(item.workflowRunId || ""))
            : false;
        return {
          id: item.id,
          category: item.category,
          summary: item.summary || null,
          contentPreview: truncate(item.content, 240),
          hasEmbedding,
          summaryKind: typeof metadata.summaryKind === "string" ? metadata.summaryKind : undefined,
          importance: typeof metadata.importance === "string" ? metadata.importance : undefined,
          entityKeys,
          createdAt: item.createdAt,
        } satisfies ThreadMemoryInsight;
      });

      const sortedItems = groupBy !== "category"
        ? mapped
        : mapped.sort((a, b) => {
          const categoryDelta = categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category);
          if (categoryDelta !== 0) return categoryDelta;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

      return {
        items: sortedItems,
        groupedCounts,
        total: category ? groupedCounts[category] || 0 : Object.values(groupedCounts).reduce((sum, value) => sum + value, 0),
      };
    } catch (error) {
      logger.error({
        message: "Failed to list thread memory insights",
        scope: "context.insights",
        details: { threadId, error: error instanceof Error ? error.message : String(error) },
      });
      return {
        items: [],
        groupedCounts: {
          workflow_run: 0,
          assistant_decision: 0,
          thread_state: 0,
          audit_event: 0,
          chat_summary: 0,
        },
        total: 0,
      };
    }
  }
}
