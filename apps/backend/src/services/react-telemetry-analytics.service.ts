/**
 * @fileoverview services/react-telemetry-analytics.service.
 *
 * Aggregates ReAct telemetry blocks into thread-level analytics summaries.
 */
import { ChatRepo } from "../repositories/chat.repo";

type TelemetrySummary = {
    totalTelemetryBlocks: number;
    answerModes: Record<string, number>;
    workflowUsage: Record<string, number>;
    rerunAvoidedCount: number;
    cacheHitCount: number;
    fieldExtractionCount: number;
    totalToolCalls: number;
    repeatedToolCalls: number;
    avgStepCount: number | null;
    avgContextsUsed: number | null;
};

function parseMetadataEntries(metadata: unknown): Record<string, string> {
    const entries = Array.isArray(metadata) ? metadata : [];
    const result: Record<string, string> = {};
  for (const entry of entries) {
        const text = String(entry || "");
        const idx = text.indexOf(":");
    if (idx === -1) continue;
        const key = text.slice(0, idx).trim();
        const value = text.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function toInt(value: string | undefined): number | null {
  if (!value) return null;
    const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return Math.round((nums.reduce((sum, n) => sum + n, 0) / nums.length) * 100) / 100;
}

/**
 * Computes thread-level ReAct telemetry metrics from assistant message metadata.
 */
export class ReActTelemetryAnalyticsService {
    static async summarizeThread(threadId: string, options?: { limit?: number }) {
        const limit = Math.max(20, Math.min(500, options?.limit || 200));
        const messages = await ChatRepo.getMessages(threadId, { limit });
        const assistantMessages = messages.filter((message: any) => message.role === "assistant");

        const summary: TelemetrySummary = {
      totalTelemetryBlocks: 0,
      answerModes: {},
      workflowUsage: {},
      rerunAvoidedCount: 0,
      cacheHitCount: 0,
      fieldExtractionCount: 0,
      totalToolCalls: 0,
      repeatedToolCalls: 0,
      avgStepCount: null,
      avgContextsUsed: null,
    };

        const stepCounts: number[] = [];
        const contextCounts: number[] = [];
        const recentTurns: Array<Record<string, unknown>> = [];

    for (const message of assistantMessages) {
            const rawBlocks = (message as any).blocks;
            const blocks = Array.isArray(rawBlocks)
        ? rawBlocks
        : Array.isArray(rawBlocks?.blocks)
          ? rawBlocks.blocks
          : [];

      for (const block of blocks) {
        if (!block || block.type !== "source") continue;
                const parsed = parseMetadataEntries((block as any).metadata);
        if (!parsed.reactAnswerMode && !parsed.answerMode) continue;

        summary.totalTelemetryBlocks += 1;
                const answerMode = parsed.reactAnswerMode || parsed.answerMode || "unknown";
        summary.answerModes[answerMode] = (summary.answerModes[answerMode] || 0) + 1;

                const workflow = parsed.reactWorkflow || parsed.workflow;
        if (workflow) {
          summary.workflowUsage[workflow] = (summary.workflowUsage[workflow] || 0) + 1;
        }

        if (parsed.reactRerunAvoided === "true") summary.rerunAvoidedCount += 1;
        if (parsed.reactCacheHit === "true") summary.cacheHitCount += 1;
        if (parsed.reactFieldExtraction === "true") summary.fieldExtractionCount += 1;

                const toolCalls = toInt(parsed.reactToolCalls);
        if (toolCalls !== null) summary.totalToolCalls += toolCalls;
                const repeated = toInt(parsed.reactRepeatedToolCalls);
        if (repeated !== null) summary.repeatedToolCalls += repeated;
                const stepCount = toInt(parsed.reactStepCount);
        if (stepCount !== null) stepCounts.push(stepCount);
                const contextsUsed = toInt(parsed.reactContextsUsed);
        if (contextsUsed !== null) contextCounts.push(contextsUsed);

        recentTurns.push({
          messageId: message.id,
          createdAt: message.createdAt,
          source: parsed.reactSource || "unknown",
          answerMode,
          workflow: workflow || null,
                    rerunAvoided: parsed.reactRerunAvoided === "true",
                    cacheHit: parsed.reactCacheHit === "true",
                    fieldExtraction: parsed.reactFieldExtraction === "true",
          toolCalls,
          repeatedToolCalls: repeated,
          stepCount,
          contextsUsed,
          confidence: parsed.reactConfidence || null,
        });
      }
    }

    summary.avgStepCount = avg(stepCounts);
    summary.avgContextsUsed = avg(contextCounts);

    return {
      summary,
      recentTurns: recentTurns.slice(-20).reverse(),
      scannedMessages: assistantMessages.length,
    };
  }
}
