/**
 * @fileoverview services/agent.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { Agent } from "@mastra/core/agent";
import { ChatService } from "./chat.service";
import { ChatRepo } from "../repositories/chat.repo";
import { ContextService } from "./context.service";
import { TemporalService, type TemporalResolutionInput } from "./temporal.service";
import { OrchestratorService } from "./orchestrator.service";
import { getRuntimeConfig, isInteractiveQuestionEnforced } from "../config/runtime.config";
import { createCoreAgentTools } from "./agent-runtime/tools";
import { AgentMcpService } from "./agent-runtime/mcp.service";
import type { AgentRunInput, AgentRunOutput, AgentToolMap } from "./agent-runtime/types";
import type { ConversationMessage, RetrievedContext } from "../providers/llm/provider.interface";
import { contextConfig, getContextMaxRetrievalForModel } from "../config/context.config";
import {
  AutoModelRouterService,
  type AutoRouterCandidate,
  type AutoRouterDecision,
} from "./auto-router.service";
import { buildReActTelemetryMetadata, logReActTelemetry } from "./react-telemetry.service";
import { logger } from "../util/logger";

type StreamBlock = { type: string; [key: string]: any };

type StreamCallbacks = {
    onBlock: (index: number, block: StreamBlock) => void;
    onChunk: (blockIndex: number, content: string) => void;
    onBlockEnd: (blockIndex: number) => void;
};

type AgentInputNormalization = {
    normalizedContent: string;
  slashWorkflowKey?: string;
  pendingWorkflowKey?: string;
  priorUserGoal?: string;
};

type LegacyDelegationReason =
  | "attachments_require_orchestrator"
  | "interactive_followup_require_orchestrator"
  | "deterministic_route_require_orchestrator";

type CandidateAttempt = {
    candidate: AutoRouterCandidate;
    ok: boolean;
  latencyMs?: number;
  error?: string;
};

function truncate(value: string, max: number): string {
  if (!value) return value;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function toConversationHistory(messages: any[]): ConversationMessage[] {
  return messages
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: String(m.content || ""),
    }))
    .filter((m) => m.content.trim().length > 0);
}

function estimateTokens(value: string): number {
    const text = String(value || "");
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function truncateToTokenBudget(value: string, maxTokens: number): string {
    const text = String(value || "");
  if (!text) return "";
    const maxChars = Math.max(64, Math.floor(Math.max(1, maxTokens) * 4));
  return truncate(text, maxChars);
}

function buildConversationHistoryWithinBudget(messages: any[], maxTotalTokens: number): ConversationMessage[] {
    const normalized = toConversationHistory(messages);
  if (!normalized.length) return [];

    const picked: ConversationMessage[] = [];
    let usedTokens = 0;
  for (let i = normalized.length - 1; i >= 0; i -= 1) {
        const msg = normalized[i];
        const clipped = truncateToTokenBudget(msg.content, contextConfig.maxMessageTokens);
    if (!clipped.trim()) continue;
        const tokenCost = estimateTokens(clipped);
    if (picked.length > 0 && usedTokens + tokenCost > maxTotalTokens) break;
    picked.push({ role: msg.role, content: clipped });
    usedTokens += tokenCost;
    if (usedTokens >= maxTotalTokens) break;
  }
  return picked.reverse();
}

const AGENT_CONFIRMATION_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please|please do|run it|go for it|proceed|continue)\s*[.!]?\s*$/i,
  /^\s*(yes|yeah|sure|ok|okay)\s+(check|run|do|go|fetch|scan|trigger|please|proceed|continue)/i,
];

const AGENT_DATA_FETCH_PATTERNS = [
  /^\s*(fetch|get|pull|load)\s+(the\s+)?data\b/i,
  /^\s*(fetch|get|pull|load)\b.*\b(answer|respond|reply)\b/i,
  /^\s*(answer|respond|reply)\b.*\busing\b.*\b(data|result|workflow)\b/i,
];

function isAgentConfirmationLike(message: string): boolean {
    const raw = String(message || "").trim();
  return AGENT_CONFIRMATION_PATTERNS.some((pattern) => pattern.test(raw));
}

function isAgentDataFetchLike(message: string): boolean {
    const raw = String(message || "").trim();
  return AGENT_DATA_FETCH_PATTERNS.some((pattern) => pattern.test(raw));
}

function extractWorkflowHintFromText(text: string): string | null {
    const body = String(text || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!body) return null;

    const patterns = [
    /need to run\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /need\s+(?:data|details|info|information)\s+from\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /(?:run|execute|trigger|fetch)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /workflow\s+["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+would need to run/i,
    /can\s+(?:run|execute|trigger|fetch)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /you can fetch.*?running\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /to get .*?,\s*(?:you(?:'|’)ll need to|run)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /from\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
  ];

  for (const pattern of patterns) {
        const match = body.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function findPendingWorkflowFromMessages(messages: any[]): string | null {
    const assistantMessages = [...messages].reverse().filter((m) => m.role === "assistant");
  for (const assistant of assistantMessages) {
        const content = String(assistant.content || "");
        const rawBlocks = (assistant as any)?.blocks;
        const blocks = Array.isArray(rawBlocks)
      ? rawBlocks
      : Array.isArray(rawBlocks?.blocks)
        ? rawBlocks.blocks
        : [];
        const questionPrompts = blocks
      .filter((b: any) => b?.type === "question_mcq")
      .map((b: any) => {
                const prompt = String(b?.prompt || "");
                const optText = Array.isArray(b?.options)
          ? b.options.map((o: any) => `${String(o?.label || "")} ${String(o?.description || "")}`).join(" ")
          : "";
        return `${prompt} ${optText}`.trim();
      })
      .filter(Boolean);
        const metadataText = blocks
      .filter((b: any) => b?.type === "source")
      .flatMap((b: any) => Array.isArray(b?.metadata) ? b.metadata.map((m: any) => String(m)) : []);
        const candidate = [content, ...questionPrompts, ...metadataText].join("\n");
        const workflowHint = extractWorkflowHintFromText(candidate);
    if (workflowHint) return workflowHint;
  }
  return null;
}

function findPriorUserGoal(messages: any[]): string | null {
    const recentUsers = [...messages].reverse().filter((m) => m.role === "user");
  for (const message of recentUsers) {
        const content = String(message.content || "").trim();
    if (!content) continue;
    if (isAgentConfirmationLike(content)) continue;
    if (isAgentDataFetchLike(content)) continue;
    return content;
  }
  return null;
}

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

async function buildPromptContext(input: AgentRunInput): Promise<{
    history: ConversationMessage[];
  retrievedContext?: RetrievedContext;
    contextText: string;
}> {
    const allMessages = await ChatService.getMessages(input.threadId);
    const history = buildConversationHistoryWithinBudget(
    allMessages,
    Math.min(contextConfig.targetWindowTokens, Math.max(4_000, contextConfig.historyBudgetTokens)),
  );
    const contextLimit = Math.max(
    getContextMaxRetrievalForModel(input.model),
    Math.ceil(contextConfig.retrievedContextBudgetTokens / Math.max(1, contextConfig.maxContextItemTokens)),
  );
    const contextItems = await ContextService.getThreadContext(input.threadId, {
    limit: contextLimit,
    categories: ["thread_state", "workflow_run", "assistant_decision"],
  });
    const contextText = ContextService.formatForPrompt(contextItems, {
    maxTotalTokens: contextConfig.retrievedContextBudgetTokens,
    maxTokensPerItem: contextConfig.maxContextItemTokens,
    maxDecisionItems: 8,
  });
  return {
    history,
    retrievedContext: contextText ? { formatted: contextText } : undefined,
    contextText,
  };
}

function buildAgentInstructions(): string {
  return [
    "You are the main orchestration agent for a chat-first workflow operating system.",
    "Use ReAct behavior: think briefly, choose tools deliberately, observe results, and then answer.",
    "Prefer deterministic tool calls over assumptions whenever data is available.",
    "You have real tool access in this environment, including workflow search, workflow detail lookup, workflow triggering, recent context lookup, attachment lookup, and approval tools.",
    "Prefer search_workflows or get_workflow_details before execution when the target workflow is not fully certain.",
    "For longer workflow jobs, prefer trigger_workflow_async followed by get_workflow_run or wait_for_workflow_run so you can act, observe, and then answer.",
    "Never claim that you cannot execute workflows or that the user must manually trigger a workflow when the available tools can do it for you.",
    "Do not execute risky/destructive actions unless the relevant tool allows it and approval path is respected.",
    "When answering, be concise and return clear operational outcomes.",
    "If user choice is required, ask in explicit option format (numbered choices) suitable for MCQ rendering.",
    "If the user already confirmed execution (yes/proceed), do not ask the same confirmation again in the next turn.",
    "Never hallucinate missing data. If evidence is missing, clearly state what is missing and why.",
  ].join(" ");
}

function extractUserPreferenceHints(history: ConversationMessage[]): string[] {
    const userMsgs = history
    .filter((m) => m.role === "user")
    .slice(-12)
    .map((m) => String(m.content || "").toLowerCase());
    const hints: string[] = [];
  if (userMsgs.some((t) => /mcq|multiple choice|options/.test(t))) {
    hints.push("User prefers option-style prompts in MCQ format when choices are needed.");
  }
  if (userMsgs.some((t) => /table format|in table|tabular/.test(t))) {
    hints.push("User prefers tabular output when the data is structured.");
  }
  if (userMsgs.some((t) => /detailed|in detail|complete answer/.test(t))) {
    hints.push("User prefers detailed, complete answers when evidence supports it.");
  }
  if (userMsgs.some((t) => /concise|short|brief/.test(t))) {
    hints.push("User prefers concise responses unless they ask for detail.");
  }
  if (userMsgs.some((t) => /grounded|no hallucination|strict/.test(t))) {
    hints.push("User requires strictly grounded answers from available evidence.");
  }
  return hints;
}

function buildAdaptiveAgentInstructions(args: {
    history: ConversationMessage[];
    contextText: string;
    currentUserMessage: string;
}): string {
    const base = buildAgentInstructions();
    const prefHints = extractUserPreferenceHints(args.history);
    const runtimeHints: string[] = [
    "Behavior policy:",
    "- Detect whether the user asks for execution vs. answer-only follow-up.",
    "- For follow-up questions, prefer existing thread evidence before suggesting reruns.",
    "- For workflow follow-ups, prefer this sequence: find_relevant_workflow_runs -> extract_workflow_run_fields for exact values -> load_complete_workflow_cache only when broader evidence is needed.",
    "- Before claiming evidence is missing, use the relevant context/workflow tools to check whether the data can be retrieved or refreshed.",
    "- If the user asks for first-party data that likely lives in a workflow, proactively use workflow tools to find and run the relevant workflow when safe.",
    "- Before triggering a workflow, prefer a quick lookup step unless the workflow target is already explicit.",
    "- If execution is required and user intent is explicit or already approved, trigger the workflow instead of telling the user to do it themselves.",
    "- If execution is required but approval is still needed, ask one clear MCQ-style confirmation and wait for answer.",
    "- If user confirms, execute immediately; do not re-ask the same confirmation.",
    "- After a tool action, observe the result and use it in the next step instead of repeating the same tool call.",
    "- Preserve consistency with prior user instructions in this thread.",
  ];
    const approvalPolicyHint = getRuntimeConfig().approvalMode === "auto"
    ? "Approval policy: auto approval is enabled. You may execute available tools directly and must clearly inform the user what actions you performed."
    : "Approval policy: default approval is enabled. Before sensitive actions, prefer approval-aware execution and explicit approval cards when needed.";
    const contextHint = args.contextText
    ? `Context available: yes (use it before asking user to rerun workflows).`
    : `Context available: limited (ask clarifying question only when required).`;
    const preferenceSection = prefHints.length
    ? `User preference memory:\n- ${prefHints.join("\n- ")}`
    : "User preference memory: no explicit preferences extracted yet.";
  return [base, runtimeHints.join("\n"), approvalPolicyHint, contextHint, preferenceSection, `Current user turn: ${args.currentUserMessage}`]
    .filter(Boolean)
    .join("\n\n");
}

function stripInlineMarkdown(input: string): string {
  return input
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`(.*?)`/g, "$1")
    .replace(/^\s*[-*]\s*/, "")
    .trim();
}

function isActionableQuestionPrompt(prompt: string): boolean {
    const raw = String(prompt || "").trim().toLowerCase();
  if (!raw) return false;
  return /\b(choose|select|continue|proceed|which option|what do you want|would you like|do you want|should i|can i|may i)\b/.test(raw);
}

function isActionableQuestionOption(label: string): boolean {
    const raw = String(label || "").trim().toLowerCase();
  if (!raw) return false;
  return /\b(yes|no|proceed|continue|not now|cancel|stop|retry|rerun|run now|use old|use cached|approve|reject|fetch|run)\b/.test(raw);
}

function parseAgentQuestionBlock(text: string): StreamBlock | null {
    const raw = String(text || "").trim();
  if (!raw) return null;
    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    const options: Array<{ id: string; label: string; valueToSend: string; description?: string }> = [];
    let firstOpt = -1;
  for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\d+)[\).\:-]\s*(.+)$/);
    if (!m) continue;
    if (firstOpt === -1) firstOpt = i;
        const idx = Number(m[1]);
        const body = stripInlineMarkdown(m[2]);
    if (!body) continue;
    const [left, right] = body.split(/\s+—\s+|\s+-\s+/, 2);
        const label = stripInlineMarkdown(left || body);
        let valueToSend = label;
        const lower = label.toLowerCase();
    if (lower.includes("use old")) valueToSend = "use old";
    else if (lower.includes("rerun") || lower.includes("run again") || lower.includes("retry")) valueToSend = "rerun now";
    else if (lower.includes("yes") || lower.includes("proceed")) valueToSend = "yes proceed";
    else if (lower.includes("not now") || lower.includes("no")) valueToSend = "no";
    options.push({
      id: `opt_${idx}`,
      label,
      valueToSend,
      description: right ? stripInlineMarkdown(right) : undefined,
    });
  }
  if (options.length >= 2 && firstOpt !== -1) {
        const prompt = stripInlineMarkdown(lines.slice(0, firstOpt).join(" "));
    if (!prompt) return null;
        const hasActionableOptions = options.some((opt) => isActionableQuestionOption(opt.label));
    if (!hasActionableOptions && !isActionableQuestionPrompt(prompt)) return null;
    return {
      type: "question_mcq",
      questionId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      options,
      allowFreeText: false,
    };
  }
    const asksForChoice =
    /\b(would you like|do you want|should i|can i|could i|shall i|let me know if you(?:'|’)d like)\b/i.test(raw);
    const executionVerb =
    /\b(run|execute|trigger|rerun|retry|refresh|rescan|scan|fetch|start|launch|proceed)\b/i.test(raw);
    const executionTarget =
    /\b(workflow|action|automation|task|run)\b/i.test(raw);
    const nonExecutionHelp =
    /\b(format|rephrase|rewrite|shorten|length|tone|style|anything else|help with anything else|wording)\b/i.test(raw);

    const proceedLike = asksForChoice && executionVerb && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(raw));
  if (nonExecutionHelp && !executionTarget) return null;
  if (!proceedLike) return null;
  return {
    type: "question_mcq",
    questionId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    prompt: "Choose how you want to continue:",
    options: [
      { id: "yes_proceed", label: "Yes, proceed", valueToSend: "yes proceed", description: "Run the workflow now.", recommended: true },
      { id: "not_now", label: "Not now", valueToSend: "no", description: "Keep current context without running." },
    ],
    allowFreeText: false,
  };
}

function shouldForceAgentQuestion(text: string): boolean {
  if (!isInteractiveQuestionEnforced()) return false;
    const raw = String(text || "").trim();
  if (!raw) return false;
    const asksForChoice =
    /\b(would you like|do you want|should i|can i|could i|shall i|let me know if you(?:'|’)d like)\b/i.test(raw);
    const executionVerb =
    /\b(run|execute|trigger|rerun|retry|refresh|rescan|scan|fetch|start|launch|proceed)\b/i.test(raw);
    const executionTarget =
    /\b(workflow|action|automation|task|run)\b/i.test(raw);
    const nonExecutionHelp =
    /\b(format|rephrase|rewrite|shorten|length|tone|style|anything else|help with anything else|wording)\b/i.test(raw);
  if (nonExecutionHelp && !executionTarget) return false;
  return asksForChoice && executionVerb && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(raw));
}

function buildForcedAgentQuestion(text: string): StreamBlock {
    const hintMatch =
    String(text || "")
      .replace(/\*\*/g, "")
      .match(/(?:run|execute|trigger|fetch)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i);
    const hint = hintMatch?.[1]?.trim();
  return {
    type: "question_mcq",
    questionId: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    prompt: hint
      ? `I can run the ${hint} workflow now. Choose how you want to continue:`
      : "Choose how you want to continue:",
    options: [
      {
        id: "forced_yes",
        label: "Yes, proceed",
        valueToSend: "yes proceed",
        description: "Run the workflow now.",
        recommended: true,
      },
      {
        id: "forced_no",
        label: "Not now",
        valueToSend: "no",
        description: "Keep current context without running.",
      },
    ],
    allowFreeText: false,
  };
}

function isReasoningHeavyTurn(content: string, contextText: string): boolean {
    const text = `${content}\n${contextText}`.toLowerCase();
  if (!text.trim()) return false;
  if (/(follow[-\s]?up|based on|from the data|grounded|compare|which|where|exact|detail|list all)/i.test(text)) return true;
  if (/(count|sum|average|avg|min|max|greater than|less than|between|filter)/i.test(text)) return true;
  return text.length > 1600;
}

function buildAgentPrompt(input: AgentRunInput, contextText: string): string {
    const sections = [
    `Thread ID: ${input.threadId}`,
    `Trace ID: ${input.traceId}`,
    contextText ? `Recent context:\n${truncateToTokenBudget(contextText, contextConfig.retrievedContextBudgetTokens)}` : "",
    `User request:\n${input.content}`,
    "Use tools when needed. If tools are not needed, provide a direct answer.",
  ].filter(Boolean);
  return sections.join("\n\n");
}

function maxAgentSteps(): number {
  return getRuntimeConfig().agentRuntime.maxSteps;
}

function resolveAgentExecutionModel(candidate: AutoRouterCandidate): string {
  return getRuntimeConfig().agentRuntime.mastraAgentModel || candidate.mastraModel;
}

function formatAttemptChain(attempts: CandidateAttempt[]): string {
  return attempts
    .map((a) => `${a.candidate.providerLabel}:${a.candidate.model}${a.ok ? "" : "×"}`)
    .join(" -> ");
}

function buildAgentSourceMetadata(args: {
    selected: AutoRouterCandidate;
    decision: AutoRouterDecision;
    attempts: CandidateAttempt[];
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

    private static async normalizeInputForAgent(threadId: string, content: string): Promise<AgentInputNormalization> {
        const raw = String(content || "").trim();
        const slashMatch = raw.match(/^\/([a-zA-Z0-9._-]+)(?:\s+(.*))?$/);
    if (!slashMatch) {
            const messages = await ChatService.getMessages(threadId);
            const pendingWorkflowKey = findPendingWorkflowFromMessages(messages);
            const priorUserGoal = findPriorUserGoal(messages);
      if ((isAgentConfirmationLike(raw) || isAgentDataFetchLike(raw)) && pendingWorkflowKey) {
                const normalized = [
          `The user has already approved execution.`,
          `Immediately run the workflow "${pendingWorkflowKey}" using workflow tools.`,
          priorUserGoal ? `Original user goal to satisfy after the run: ${priorUserGoal}` : "",
          `After execution, answer the user's request directly from the workflow result.`,
          `Do not say you lack the ability to execute workflows.`,
        ].filter(Boolean).join(" ");
        return {
          normalizedContent: normalized,
          pendingWorkflowKey,
          priorUserGoal: priorUserGoal || undefined,
        };
      }
      return {
        normalizedContent: content,
        pendingWorkflowKey: pendingWorkflowKey || undefined,
        priorUserGoal: priorUserGoal || undefined,
      };
    }
        const workflowKey = slashMatch[1];
        const trailing = String(slashMatch[2] || "").trim();
        const normalized = [
      `Explicit workflow slash command detected.`,
      `Workflow key: "${workflowKey}".`,
      `Execute this workflow as an explicit user request using workflow tools.`,
      trailing ? `Additional user payload: ${trailing}` : `No additional payload provided.`,
      `Return execution status and concise result summary.`,
    ].join(" ");
    return {
      normalizedContent: normalized,
      slashWorkflowKey: workflowKey,
    };
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
        const normalized = await this.normalizeInputForAgent(input.threadId, input.content);
        const effectiveInput: AgentRunInput = {
      ...input,
      content: normalized.normalizedContent,
    };
    const { history, contextText } = await buildPromptContext(effectiveInput);
        const routingHint = isReasoningHeavyTurn(input.content, contextText) ? "reasoning_heavy" : "default";
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId: input.providerId,
      model: input.model,
      maxCandidates: Number(process.env.AUTO_ROUTER_MAX_CANDIDATES || "8"),
      routingHint,
    });
    if (!decision.candidates.length) {
      throw new Error("No model candidates available for agent runtime.");
    }
    const { tools, mcpToolCount, mcpErrors } = await this.getTools(effectiveInput);
        const attempts: CandidateAttempt[] = [];
        let output: any = null;
        let selected: AutoRouterCandidate | null = null;
        let executedModel = "";

    for (const candidate of decision.candidates) {
            const startedAt = Date.now();
      try {
                const agentModel = resolveAgentExecutionModel(candidate);
                const agent = new Agent({
          id: "main-agent-runtime",
          name: "Main Agent Runtime",
          instructions: buildAdaptiveAgentInstructions({
            history,
            contextText,
            currentUserMessage: input.content,
          }),
          model: agentModel,
          tools,
          defaultOptions: {
            maxSteps: maxAgentSteps(),
          },
        });
        output = await agent.generate(buildAgentPrompt(effectiveInput, contextText), {
          maxSteps: maxAgentSteps(),
        } as any);
                const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        attempts.push({ candidate, ok: true, latencyMs });
        selected = candidate;
        executedModel = agentModel;
        break;
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || "Unknown model failure"),
        });
      }
    }

    if (!selected || !output) {
      throw new Error(`All agent model candidates failed: ${formatAttemptChain(attempts)}`);
    }

        const text = String(output?.text || "").trim() || "I could not produce a response.";
        const toolCalls = normalizeToolCalls(output?.toolCalls);
        const planLines = [
      `Model: \`${executedModel}\``,
      `Selected provider: \`${selected.providerLabel}\``,
      `Selected model: \`${selected.model}\``,
      `Routing mode: \`${decision.mode}\``,
      `Failovers: ${Math.max(0, attempts.length - 1)}`,
      `Tool calls: ${toolCalls.length}`,
      ...(normalized.slashWorkflowKey ? [`Slash workflow: \`${normalized.slashWorkflowKey}\``] : []),
      ...(normalized.pendingWorkflowKey ? [`Pending workflow: \`${normalized.pendingWorkflowKey}\``] : []),
      ...(normalized.priorUserGoal ? [`Prior user goal: ${normalized.priorUserGoal}`] : []),
      ...toolCalls.map((c, idx) => `${idx + 1}. ${c.toolName}`),
      ...(mcpErrors.length ? [`MCP warnings: ${mcpErrors.join(" | ")}`] : []),
    ];

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
      content: (await this.normalizeInputForAgent(threadId, content)).normalizedContent,
      traceId,
      userId,
      providerId,
      model,
    });
        const decision = await AutoModelRouterService.resolveCandidates({
      providerId,
      model,
      maxCandidates: Number(process.env.AUTO_ROUTER_MAX_CANDIDATES || "8"),
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

        const normalized = await this.normalizeInputForAgent(threadId, content);
        let selected: AutoRouterCandidate | null = null;
        let executedModel = "";
        let full: any = null;
        let text = "";
        const attempts: CandidateAttempt[] = [];
        let streamShellOpened = false;

    for (const candidate of decision.candidates) {
            const startedAt = Date.now();
            let emittedChunks = false;
      try {
                const agentModel = resolveAgentExecutionModel(candidate);
                const agent = new Agent({
          id: "main-agent-runtime",
          name: "Main Agent Runtime",
          instructions: buildAdaptiveAgentInstructions({
            history,
            contextText,
            currentUserMessage: content,
          }),
          model: agentModel,
          tools,
          defaultOptions: {
            maxSteps: maxAgentSteps(),
          },
        });
                const stream = await agent.stream(
          buildAgentPrompt(
            { threadId, content: normalized.normalizedContent, traceId, userId, providerId, model },
            contextText,
          ),
          {
            maxSteps: maxAgentSteps(),
          } as any,
        );
        selected = candidate;
        executedModel = agentModel;
        if (!streamShellOpened) {
          callbacks.onBlock(0, {
            type: "summary",
            items: ["Main agent runtime (Mastra) is processing this request."],
          });
          callbacks.onBlockEnd(0);
          callbacks.onBlock(1, { type: "markdown", text: "" });
          streamShellOpened = true;
        }

                const reader = stream.textStream.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            emittedChunks = true;
            text += value;
            callbacks.onChunk(1, value);
          }
        }
        full = await stream.getFullOutput();
                const latencyMs = Date.now() - startedAt;
        AutoModelRouterService.reportSuccess(candidate, latencyMs);
        attempts.push({ candidate, ok: true, latencyMs });
        break;
      } catch (err: any) {
        AutoModelRouterService.reportFailure(candidate);
        attempts.push({
          candidate,
          ok: false,
          error: String(err?.message || err || "Unknown model failure"),
        });
        if (emittedChunks) {
          throw err;
        }
        selected = null;
        executedModel = "";
      }
    }

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
