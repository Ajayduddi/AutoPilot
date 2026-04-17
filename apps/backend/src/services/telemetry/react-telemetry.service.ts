/**
 * @fileoverview services/react-telemetry.service.
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
import { logger } from '../../util/logger';

/**
 * ReActTelemetryEvent type alias.
 */
export type ReActTelemetryEvent = {
    source: "orchestrator" | "agent_runtime";
    answerMode: string;
    threadId: string;
  traceId?: string;
  workflowKey?: string;
  toolCalls?: string[];
  stepCount?: number;
  contextsUsed?: number;
  workflowsUsed?: string[];
  relevantRuns?: number;
  requestedFields?: string[];
  usedFieldExtraction?: boolean;
  cacheHit?: boolean;
  rerunAvoided?: boolean;
  confidence?: string;
};

function countRepeatedToolCalls(toolCalls: string[]): number {
    const seen = new Set<string>();
    let repeated = 0;
  for (const call of toolCalls) {
    if (seen.has(call)) repeated += 1;
    seen.add(call);
  }
  return repeated;
}

/** Builds compact metadata lines for chat blocks or traces from telemetry event data. */
export function buildReActTelemetryMetadata(event: ReActTelemetryEvent): string[] {
    const toolCalls = event.toolCalls || [];
  return [
    `reactSource: ${event.source}`,
    `reactAnswerMode: ${event.answerMode}`,
    ...(event.workflowKey ? [`reactWorkflow: ${event.workflowKey}`] : []),
    ...(typeof event.contextsUsed === "number" ? [`reactContextsUsed: ${event.contextsUsed}`] : []),
    ...(event.workflowsUsed?.length ? [`reactWorkflowsUsed: ${event.workflowsUsed.join("|")}`] : []),
    ...(typeof event.relevantRuns === "number" ? [`reactRelevantRuns: ${event.relevantRuns}`] : []),
    ...(event.requestedFields?.length ? [`reactRequestedFields: ${event.requestedFields.join("|")}`] : []),
    `reactFieldExtraction: ${event.usedFieldExtraction ? "true" : "false"}`,
    `reactCacheHit: ${event.cacheHit ? "true" : "false"}`,
    `reactRerunAvoided: ${event.rerunAvoided ? "true" : "false"}`,
    ...(toolCalls.length ? [`reactToolCalls: ${toolCalls.length}`, `reactRepeatedToolCalls: ${countRepeatedToolCalls(toolCalls)}`] : []),
    ...(typeof event.stepCount === "number" ? [`reactStepCount: ${event.stepCount}`] : []),
    ...(event.confidence ? [`reactConfidence: ${event.confidence}`] : []),
  ];
}

/** Emits normalized ReAct telemetry as a structured JSON log entry. */
export function logReActTelemetry(event: ReActTelemetryEvent): void {
    const toolCalls = event.toolCalls || [];
  logger.info({
      scope: 'react-telemetry.service',
      message: 'ReAct telemetry event',
      source: event.source,
      answerMode: event.answerMode,
      threadId: event.threadId,
      traceId: event.traceId,
      workflowKey: event.workflowKey,
      toolCalls: toolCalls.length,
      repeatedToolCalls: countRepeatedToolCalls(toolCalls),
      stepCount: event.stepCount,
      contextsUsed: event.contextsUsed,
      workflowsUsed: event.workflowsUsed,
      relevantRuns: event.relevantRuns,
      requestedFields: event.requestedFields,
      usedFieldExtraction: !!event.usedFieldExtraction,
      cacheHit: !!event.cacheHit,
      rerunAvoided: !!event.rerunAvoided,
      confidence: event.confidence,
    });
}
