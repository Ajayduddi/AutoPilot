/**
 * @fileoverview services/agent.service.
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
import { ChatService } from "../chat.service";
import { TemporalService, type TemporalResolutionInput } from "../temporal.service";
import { OrchestratorService } from "../orchestrator/orchestrator.service";
import { getRuntimeConfig } from "../../config/runtime.config";
import { createCoreAgentTools } from "../agent-runtime/tools";
import { AgentMcpService } from "../agent-runtime/mcp.service";
import type { AgentRunInput, AgentRunOutput, AgentToolMap } from "../agent-runtime/types";
import {
  normalizeInputForAgent,
} from "./agent-input-normalizer.service";
import {
  buildAgentPlanLines,
  buildAgentSourceMetadata,
  formatAttemptChain,
} from "./agent-output.service";
import {
  runAgentGenerateAttempts,
  runAgentStreamingAttempts,
} from "./agent-execution.service";
import {
  buildPromptContext,
  isReasoningHeavyTurn,
} from "./agent-prompt.service";
import {
  buildForcedAgentQuestion,
  parseAgentQuestionBlock,
  shouldForceAgentQuestion,
} from "./agent-question.service";
import {
  AutoModelRouterService,
} from "../ai-routing/auto-router.service";
import { buildReActTelemetryMetadata, logReActTelemetry } from "../telemetry/react-telemetry.service";
import { logger } from "../../util/logger";

type StreamBlock = { type: string;[key: string]: any };

type StreamCallbacks = {
  onBlock: (index: number, block: StreamBlock) => void;
  onChunk: (blockIndex: number, content: string) => void;
  onBlockEnd: (blockIndex: number) => void;
};

type LegacyDelegationReason =
  | "attachments_require_orchestrator"
  | "interactive_followup_require_orchestrator"
  | "deterministic_route_require_orchestrator";

function normalizeToolCalls(raw: any[] | undefined): Array<{ toolName: string; args?: unknown }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((call) => ({
      toolName: String(call?.toolName || call?.tool || call?.name || ""),
      args: call?.args ?? call?.input ?? undefined,
    }))
    .filter((call) => call.toolName);
}

function buildTemporalSourceMetadata(answer: ReturnType<typeof TemporalService.answerIfTemporal>) {
  return [
    `answerMode: deterministic_temporal`,
    `source: deterministic_clock`,
    `timezone: ${answer.timezoneUsed || "UTC"}`,
    `generatedAt: ${answer.generatedAt || answer.iso || new Date().toISOString()}`,
  ];
}

export const __agentTestUtils = {
  buildPromptContext,
};

/**
 * Agent runtime entrypoint for tool-enabled autonomous assistant execution.
 *
 * @remarks
 * Handles input normalization, model routing, tool loading (core + MCP),
 * execution attempts with failover, and telemetry generation. When a turn
 * requires legacy deterministic behavior, callers may delegate to
 * `OrchestratorService`.
 */
export class AgentService {
  static isEnabled(): boolean {
    return true;
  }

  private static async legacyDelegationReason(
    threadId: string,
    input: { content: string; attachments?: Array<any> },
  ): Promise<LegacyDelegationReason | null> {
    const content = String(input.content || "").trim().toLowerCase();
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];

    // Keep only critical compatibility delegation.
    if (attachments.length > 0) return "attachments_require_orchestrator";
    if (/^(use old|rerun now|run again|retry|rescan|refresh)\b/.test(content)) {
      return "interactive_followup_require_orchestrator";
    }
    if (await OrchestratorService.shouldHandleDeterministicTurn(threadId, input.content)) {
      return "deterministic_route_require_orchestrator";
    }
    return null;
  }

  private static async getTools(input: AgentRunInput): Promise<{ tools: AgentToolMap; mcpToolCount: number; mcpErrors: string[] }> {
    const runtime = getRuntimeConfig();
    const coreTools = createCoreAgentTools({
      userId: input.userId,
      threadId: input.threadId,
      traceId: input.traceId,
      approvalMode: runtime.approvalMode,
    });
    const { tools: mcpTools, errors } = await AgentMcpService.listToolsSafe();
    return {
      tools: {
        ...coreTools,
        ...mcpTools,
      },
      mcpToolCount: Object.keys(mcpTools).length,
      mcpErrors: errors,
    };
  }

  private static async runGenerate(input: AgentRunInput): Promise<AgentRunOutput> {
    const normalized = await normalizeInputForAgent(input.threadId, input.content);
    const effectiveInput: AgentRunInput = {
      ...input,
      content: normalized.normalizedContent,
    };
    const { history, contextText } = await buildPromptContext(effectiveInput);
    const routingHint = isReasoningHeavyTurn(input.content, contextText) ? "reasoning_heavy" : "default";
    const decision = await AutoModelRouterService.resolveCandidates({
      providerId: input.providerId,
      model: input.model,
      maxCandidates: getRuntimeConfig().autoRouter.maxCandidates,
      routingHint,
    });
    if (!decision.candidates.length) {
      throw new Error("No model candidates available for agent runtime.");
    }
    const { tools, mcpToolCount, mcpErrors } = await this.getTools(effectiveInput);
    const {
      attempts,
      selected,
      executedModel,
      output,
    } = await runAgentGenerateAttempts({
      candidates: decision.candidates,
      history,
      contextText,
      currentUserMessage: input.content,
      promptInput: effectiveInput,
      tools,
    });

    if (!selected || !output) {
      throw new Error(`All agent model candidates failed: ${formatAttemptChain(attempts)}`);
    }

    const text = String(output?.text || "").trim() || "I could not produce a response.";
    const toolCalls = normalizeToolCalls(output?.toolCalls);
    const planLines = buildAgentPlanLines({
      executedModel,
      selected,
      decision,
      attempts,
      toolCalls,
      normalized,
      mcpErrors,
    });

    const questionBlock = parseAgentQuestionBlock(text) || (shouldForceAgentQuestion(text) ? buildForcedAgentQuestion(text) : null);
    const reactTelemetry = {
      source: "agent_runtime" as const,
      answerMode: questionBlock ? "interactive_question" : "agent_runtime_answer",
      threadId: input.threadId,
      traceId: input.traceId,
      workflowKey: normalized.pendingWorkflowKey || normalized.slashWorkflowKey,
      toolCalls: toolCalls.map((c) => c.toolName),
      stepCount: Array.isArray(output?.steps) ? output.steps.length : undefined,
      cacheHit: false,
      rerunAvoided: false,
    };
    logReActTelemetry(reactTelemetry);
    const blocks: Array<Record<string, unknown>> = [
      {
        type: "summary",
        items: [
          "Main agent runtime (Mastra) handled this request.",
          toolCalls.length
            ? `Executed ${toolCalls.length} tool call(s).`
            : "Answered without tool execution.",
        ],
      },
      {
        type: "detail_toggle",
        title: "Agent runtime plan",
        summary: "Mastra ReAct execution trace",
        children: [
          {
            type: "markdown",
            text: planLines.join("\n"),
          },
        ],
      },
      ...(questionBlock ? [questionBlock] : [{ type: "markdown", text }]),
      {
        type: "source",
        origin: "Agent Runtime",
        metadata: buildAgentSourceMetadata({
          selected,
          decision,
          attempts,
          executedModel,
          toolCalls: toolCalls.length,
          slashWorkflowKey: normalized.slashWorkflowKey,
          mcpToolCount,
          mcpErrors,
          historyCount: history.length,
        }).concat(buildReActTelemetryMetadata(reactTelemetry)),
      },
    ];

    return {
      text,
      blocks,
      meta: {
        toolCalls,
        stepCount: Array.isArray(output?.steps) ? output.steps.length : undefined,
        runtime: "mastra_runtime",
        model: executedModel,
        provider: selected.provider,
        selectedModel: selected.model,
        routingMode: decision.mode,
        failoverCount: Math.max(0, attempts.length - 1),
        attempts: attempts.map((a) => ({
          provider: a.candidate.provider,
          model: a.candidate.model,
          ok: a.ok,
          latencyMs: a.latencyMs,
          error: a.error,
        })),
        mcpToolsLoaded: mcpToolCount,
        ...(questionBlock
          ? { questionId: (questionBlock as any).questionId, interactionMode: "interactive_question" }
          : {}),
      },
    };
  }

  static async handleIncomingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId?: string,
    model?: string,
    attachments: Array<any> = [],
    temporalInput?: TemporalResolutionInput,
  ) {
    const temporal = TemporalService.answerIfTemporal(content, temporalInput || {});
    if (temporal.detected && temporal.text) {
      return await ChatService.addMessage(threadId, "assistant", temporal.text, {
        blocks: [
          { type: "summary", items: ["Main agent runtime handled this as deterministic temporal response."] },
          { type: "markdown", text: temporal.text },
          {
            type: "source",
            origin: "Deterministic Clock",
            metadata: buildTemporalSourceMetadata(temporal),
          },
        ],
      });
    }

    const reason = await this.legacyDelegationReason(threadId, { content, attachments });
    if (reason) {
      logger.info({
        scope: "agent.service",
        message: "Delegated to orchestrator",
        threadId,
        traceId,
        userId,
        routeKind: reason,
      });
      return await OrchestratorService.handleIncomingMessage(
        threadId,
        content,
        traceId,
        userId,
        providerId,
        model,
        attachments,
        temporalInput,
      );
    }

    let result: AgentRunOutput;
    try {
      result = await this.runGenerate({
        threadId,
        content,
        traceId,
        userId,
        providerId,
        model,
        temporalInput,
      });
    } catch (err) {
      logger.warn({
        scope: "agent.service",
        message: "Generate failed, falling back to orchestrator",
        threadId,
        traceId,
        userId,
        err,
      });
      return await OrchestratorService.handleIncomingMessage(
        threadId,
        content,
        traceId,
        userId,
        providerId,
        model,
        attachments,
        temporalInput,
      );
    }

    return await ChatService.addMessage(threadId, "assistant", result.text, { blocks: result.blocks });
  }

  static async handleStreamingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId: string | undefined,
    model: string | undefined,
    attachments: Array<any>,
    callbacks: StreamCallbacks,
    temporalInput?: TemporalResolutionInput,
  ): Promise<{ id: string; createdAt: any }> {
    const temporal = TemporalService.answerIfTemporal(content, temporalInput || {});
    if (temporal.detected && temporal.text) {
      callbacks.onBlock(0, {
        type: "summary",
        items: ["Main agent runtime handled this as deterministic temporal response."],
      });
      callbacks.onBlockEnd(0);
      callbacks.onBlock(1, { type: "markdown", text: temporal.text });
      callbacks.onBlockEnd(1);
      callbacks.onBlock(2, {
        type: "source",
        origin: "Deterministic Clock",
        metadata: buildTemporalSourceMetadata(temporal),
      });
      callbacks.onBlockEnd(2);
      const saved = await ChatService.addMessage(threadId, "assistant", temporal.text, {
        blocks: [
          {
            type: "summary",
            items: ["Main agent runtime handled this as deterministic temporal response."],
          },
          { type: "markdown", text: temporal.text },
          {
            type: "source",
            origin: "Deterministic Clock",
            metadata: buildTemporalSourceMetadata(temporal),
          },
        ],
      });
      return { id: saved.id, createdAt: saved.createdAt };
    }

    const reason = await this.legacyDelegationReason(threadId, { content, attachments });
    if (reason) {
      logger.info({
        scope: "agent.service",
        message: "Streaming delegated to orchestrator",
        threadId,
        traceId,
        userId,
        routeKind: reason,
      });
      return await OrchestratorService.handleStreamingMessage(
        threadId,
        content,
        traceId,
        userId,
        providerId,
        model,
        attachments,
        callbacks,
        temporalInput,
      );
    }

    const { contextText, history } = await buildPromptContext({
      threadId,
      content: (await normalizeInputForAgent(threadId, content)).normalizedContent,
      traceId,
      userId,
      providerId,
      model,
      temporalInput,
    });
    const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: getRuntimeConfig().autoRouter.maxCandidates,
      routingHint: isReasoningHeavyTurn(content, contextText) ? "reasoning_heavy" : "default",
    });
    if (!decision.candidates.length) {
      throw new Error("No model candidates available for streaming runtime.");
    }
    const { tools, mcpToolCount, mcpErrors } = await this.getTools({
      threadId,
      content,
      traceId,
      userId,
      providerId,
      model,
    });

    const normalized = await normalizeInputForAgent(threadId, content);
    const {
      selected,
      executedModel,
      full,
      text,
      attempts,
    } = await runAgentStreamingAttempts({
      candidates: decision.candidates,
      history,
      contextText,
      currentUserMessage: content,
      promptInput: { threadId, content: normalized.normalizedContent, traceId, userId, providerId, model },
      tools,
      callbacks,
    });

    if (!selected) {
      logger.warn({
        scope: "agent.service",
        message: "All streaming agent model candidates failed; delegating to orchestrator",
        threadId,
        traceId,
        userId,
        attempts: formatAttemptChain(attempts),
      });
      return await OrchestratorService.handleStreamingMessage(
        threadId,
        content,
        traceId,
        userId,
        providerId,
        model,
        attachments,
        callbacks,
        temporalInput,
      );
    }

    callbacks.onBlockEnd(1);

    const toolCalls = normalizeToolCalls(full?.toolCalls as any[]);
    const questionBlock = parseAgentQuestionBlock(text) || (shouldForceAgentQuestion(text) ? buildForcedAgentQuestion(text) : null);
    const reactTelemetry = {
      source: "agent_runtime" as const,
      answerMode: questionBlock ? "interactive_question" : "agent_runtime_answer",
      threadId,
      traceId,
      workflowKey: normalized.pendingWorkflowKey || normalized.slashWorkflowKey,
      toolCalls: toolCalls.map((c) => c.toolName),
      stepCount: Array.isArray(full?.steps) ? full.steps.length : undefined,
      cacheHit: false,
      rerunAvoided: false,
    };
    logReActTelemetry(reactTelemetry);
    const sourceMetadata = buildAgentSourceMetadata({
      selected,
      decision,
      attempts,
      executedModel,
      toolCalls: toolCalls.length,
      slashWorkflowKey: normalized.slashWorkflowKey,
      mcpToolCount,
      mcpErrors,
      historyCount: history.length,
    }).concat(buildReActTelemetryMetadata(reactTelemetry));
    if (!questionBlock) {
      callbacks.onBlock(2, {
        type: "source",
        origin: "Agent Runtime",
        metadata: sourceMetadata,
      });
      callbacks.onBlockEnd(2);
    } else {
      callbacks.onBlock(2, questionBlock);
      callbacks.onBlockEnd(2);
      callbacks.onBlock(3, {
        type: "source",
        origin: "Agent Runtime",
        metadata: [
          ...sourceMetadata,
          "answerMode: interactive_question",
          `questionId: ${(questionBlock as any).questionId}`,
        ],
      });
      callbacks.onBlockEnd(3);
    }

    const finalText = text.trim() || "I could not produce a response.";
    const blocks: Array<Record<string, unknown>> = [
      {
        type: "summary",
        items: ["Main agent runtime (Mastra) handled this request."],
      },
      ...(questionBlock ? [questionBlock] : [{ type: "markdown", text: finalText }]),
      {
        type: "source",
        origin: "Agent Runtime",
        metadata: questionBlock
          ? [...sourceMetadata, "answerMode: interactive_question", `questionId: ${(questionBlock as any).questionId}`]
          : sourceMetadata,
      },
    ];
    const saved = await ChatService.addMessage(threadId, "assistant", finalText, { blocks });
    return { id: saved.id, createdAt: saved.createdAt };
  }
}
