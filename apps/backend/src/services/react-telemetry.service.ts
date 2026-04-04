/**
 * @fileoverview services/react-telemetry.service.
 *
 * Helpers for shaping and emitting ReAct execution telemetry.
 */

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
  console.info(
    "[ReActTelemetry]",
    JSON.stringify({
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
    }),
  );
}
