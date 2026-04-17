/**
 * @fileoverview apps/backend/src/services/agent/agent-prompt.service.ts
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
import { PromptContextService } from "../context/prompt-context.service";
import type { AgentRunInput } from "../agent-runtime/types";
import type { ConversationMessage, RetrievedContext } from "../../providers/llm/provider.interface";
import { contextConfig, getContextMaxRetrievalForModel } from "../../config/context.config";
import { getRuntimeConfig } from "../../config/runtime.config";

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

export async function buildPromptContext(input: AgentRunInput): Promise<{
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
  const promptContext = await PromptContextService.buildHybridThreadPromptContext({
    surface: "agent",
    threadId: input.threadId,
    userId: input.userId,
    query: input.content,
    model: input.model,
    temporalInput: input.temporalInput,
    categories: ["thread_state", "workflow_run", "assistant_decision"],
    exactLimit: contextLimit,
    semanticLimit: Math.min(3, contextLimit),
    includeSemanticWorkflowRuns: true,
    maxDecisionItems: 8,
  });
  return {
    history,
    retrievedContext: promptContext.retrievedContext,
    contextText: promptContext.contextText,
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

export function buildAdaptiveAgentInstructions(args: {
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
    ? "Context available: yes (use it before asking user to rerun workflows)."
    : "Context available: limited (ask clarifying question only when required).";
  const preferenceSection = prefHints.length
    ? `User preference memory:\n- ${prefHints.join("\n- ")}`
    : "User preference memory: no explicit preferences extracted yet.";
  return [base, runtimeHints.join("\n"), approvalPolicyHint, contextHint, preferenceSection, `Current user turn: ${args.currentUserMessage}`]
    .filter(Boolean)
    .join("\n\n");
}

export function isReasoningHeavyTurn(content: string, contextText: string): boolean {
  const text = `${content}\n${contextText}`.toLowerCase();
  if (!text.trim()) return false;
  if (/(follow[-\s]?up|based on|from the data|grounded|compare|which|where|exact|detail|list all)/i.test(text)) return true;
  if (/(count|sum|average|avg|min|max|greater than|less than|between|filter)/i.test(text)) return true;
  return text.length > 1600;
}

export function buildAgentPrompt(input: AgentRunInput, contextText: string): string {
  const sections = [
    `Thread ID: ${input.threadId}`,
    `Trace ID: ${input.traceId}`,
    contextText ? `Recent context:\n${truncateToTokenBudget(contextText, contextConfig.retrievedContextBudgetTokens)}` : "",
    `User request:\n${input.content}`,
    "Use tools when needed. If tools are not needed, provide a direct answer.",
  ].filter(Boolean);
  return sections.join("\n\n");
}

export function maxAgentSteps(): number {
  return getRuntimeConfig().agentRuntime.maxSteps;
}
