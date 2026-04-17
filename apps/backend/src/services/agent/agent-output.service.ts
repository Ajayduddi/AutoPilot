/**
 * @fileoverview apps/backend/src/services/agent/agent-output.service.ts
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
import type {
  AutoRouterCandidate,
  AutoRouterDecision,
} from "../ai-routing/auto-router.service";
import type { AgentInputNormalization } from "./agent-input-normalizer.service";

export type AgentCandidateAttempt = {
  candidate: AutoRouterCandidate;
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export function formatAttemptChain(attempts: AgentCandidateAttempt[]): string {
  return attempts
    .map((a) => `${a.candidate.providerLabel}:${a.candidate.model}${a.ok ? "" : "×"}`)
    .join(" -> ");
}

export function buildAgentPlanLines(args: {
  executedModel: string;
  selected: AutoRouterCandidate;
  decision: AutoRouterDecision;
  attempts: AgentCandidateAttempt[];
  toolCalls: Array<{ toolName: string; args?: unknown }>;
  normalized: AgentInputNormalization;
  mcpErrors: string[];
}): string[] {
  return [
    `Model: \`${args.executedModel}\``,
    `Selected provider: \`${args.selected.providerLabel}\``,
    `Selected model: \`${args.selected.model}\``,
    `Routing mode: \`${args.decision.mode}\``,
    `Failovers: ${Math.max(0, args.attempts.length - 1)}`,
    `Tool calls: ${args.toolCalls.length}`,
    ...(args.normalized.slashWorkflowKey ? [`Slash workflow: \`${args.normalized.slashWorkflowKey}\``] : []),
    ...(args.normalized.pendingWorkflowKey ? [`Pending workflow: \`${args.normalized.pendingWorkflowKey}\``] : []),
    ...(args.normalized.priorUserGoal ? [`Prior user goal: ${args.normalized.priorUserGoal}`] : []),
    ...args.toolCalls.map((c, idx) => `${idx + 1}. ${c.toolName}`),
    ...(args.mcpErrors.length ? [`MCP warnings: ${args.mcpErrors.join(" | ")}`] : []),
  ];
}

export function buildAgentSourceMetadata(args: {
  selected: AutoRouterCandidate;
  decision: AutoRouterDecision;
  attempts: AgentCandidateAttempt[];
  toolCalls: number;
  slashWorkflowKey?: string;
  mcpToolCount: number;
  mcpErrors: string[];
  historyCount: number;
  executedModel: string;
}): string[] {
  const failedCount = args.attempts.filter((a) => !a.ok).length;
  const modelTier = args.decision.routingHint === "reasoning_heavy" ? "preferred_reasoning" : "default_auto";
  return [
    "runtime: mastra_runtime",
    `answerMode: ${args.decision.mode === "auto" ? "auto_routed" : "explicit_model"}`,
    `selectedProvider: ${args.selected.providerLabel}`,
    `selectedModel: ${args.selected.model}`,
    `model: ${args.executedModel}`,
    `toolCalls: ${args.toolCalls}`,
    `autoMode: ${args.decision.mode === "auto"}`,
    `modelTier: ${modelTier}`,
    `preferredModelPoolUsed: ${args.decision.preferredModelPoolUsed ? "true" : "false"}`,
    `failoverCount: ${failedCount}`,
    ...(failedCount > 0 ? [`attempted: ${formatAttemptChain(args.attempts)}`] : []),
    ...(args.slashWorkflowKey ? [`slashWorkflow: ${args.slashWorkflowKey}`] : []),
    `mcpToolsLoaded: ${args.mcpToolCount}`,
    ...(args.mcpErrors.length ? [`mcpWarnings: ${args.mcpErrors.join(" | ")}`] : []),
    `historyMessages: ${args.historyCount}`,
  ];
}
