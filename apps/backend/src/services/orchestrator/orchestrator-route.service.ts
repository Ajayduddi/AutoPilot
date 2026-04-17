/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-route.service.ts
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
import { contextConfig } from "../../config/context.config";
import { ChatService } from "../chat.service";
import { ContextService } from "../context/context.service";
import { WorkflowService } from "../workflow/workflow.service";
import { logger } from "../../util/logger";
import { extractWorkflowHintFromAssistantText } from "./orchestrator-question.service";

/**
 * Raw follow-up detection result before final route classification.
 */
export type FollowUpResult =
  | { detected: false }
  | { detected: true; action: "retry"; workflowKey: string }
  | { detected: true; action: "show_previous"; contextItem: any }
  | { detected: true; action: "entity_search"; query: string; results: any[] };

/**
 * High-level deterministic follow-up route used by orchestrator.
 */
export type FollowUpRoute =
  | { kind: "none" }
  | { kind: "show_previous"; contextItem: any }
  | { kind: "explicit_rerun"; workflowKey: string; autoSwitched?: boolean; contextWorkflow?: string }
  | { kind: "use_cached_choice"; workflowKey: string; contextItem: any }
  | { kind: "followup_answer"; workflowKey: string; contextItem: any };

const RETRY_PATTERNS = [
  /\b(retry|rerun|run again|re-run|do it again|try again|refresh it|refresh again|rescan)\b/i,
];

const CONFIRMATION_PATTERNS = [
  /^\s*(yes|yeah|yep|sure|ok|okay|do it|go ahead|please do|continue|proceed)\s*$/i,
];

const SHOW_PREVIOUS_PATTERNS = [
  /\b(show|display|give me|what was)\s+(the\s+)?(previous|last|prior)\s+(output|result|response|data)/i,
  /\bprevious\s+(output|result)/i,
  /\blast\s+(result|output|run)/i,
  /\bwhat\s+(happened|did it return|was the result|were the results)/i,
  /\bshow\s+(me\s+)?(the\s+)?results?\s+again/i,
];

const USE_CACHED_PATTERNS = [
  /^\s*(use old|use cached|use previous|use last|answer from previous|continue with previous)\s*$/i,
  /^\s*(old result|cached result|previous result|last result)\s*$/i,
];

const RERUN_NOW_PATTERNS = [
  /^\s*(rerun now|run now|refresh now|rescan now|retry now)\s*$/i,
  /^\s*(run|rerun|retry|refresh|rescan)\s+(it|that|portfolio|workflow)\s*(now|again)?\s*$/i,
];

const DATA_FETCH_PATTERNS = [
  /^\s*(fetch|get|pull|load)\s+(the\s+)?data\b/i,
  /^\s*(fetch|get|pull|load)\b.*\b(answer|respond|reply)\b/i,
  /^\s*(answer|respond|reply)\b.*\busing\b.*\b(data|result|workflow)\b/i,
];

const EXECUTION_COMMAND_PATTERNS = [
  /\b(run|execute|trigger|retry|rescan|refresh|rerun|re-run|refetch)\b/i,
];

function isExecutionCommand(message: string): boolean {
  return EXECUTION_COMMAND_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

/**
 * Returns true when the message is a data-fetch style command intended to
 * trigger workflow execution instead of conversational answering.
 */
export function isDataFetchCommand(message: string): boolean {
  return DATA_FETCH_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

/**
 * Returns true when user input is confirmation-like (yes/proceed style).
 */
export function isConfirmationLike(message: string): boolean {
  return CONFIRMATION_PATTERNS.some((pattern) => pattern.test(message.trim()));
}

function isLikelyFollowUpQuestion(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.length <= 180) return true;
  return /^(what|how|which|who|where|when|why|can|do|does|did|list|tell|show)\b/.test(normalized);
}

function tokenizeForWorkflowMatch(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

async function resolveWorkflowKeyFromHint(hint: string): Promise<string | null> {
  const clean = String(hint || "").trim();
  if (!clean) return null;
  const normalized = clean.toLowerCase();
  const workflows = await WorkflowService.getAll({ archived: false, enabled: true });
  const exactKey = workflows.find((workflow: any) => String(workflow.key || "").toLowerCase() === normalized);
  if (exactKey?.key) return String(exactKey.key);
  const exactName = workflows.find((workflow: any) => String(workflow.name || "").toLowerCase() === normalized);
  if (exactName?.key) return String(exactName.key);

  const compact = normalized.replace(/[\s_\-]+/g, "");
  const fuzzy = workflows.find((workflow: any) => {
    const keyCompact = String(workflow.key || "").toLowerCase().replace(/[\s_\-]+/g, "");
    const nameCompact = String(workflow.name || "").toLowerCase().replace(/[\s_\-]+/g, "");
    return keyCompact === compact || nameCompact === compact;
  });
  return fuzzy?.key ? String(fuzzy.key) : null;
}

function workflowMatchScore(message: string, workflow: any): number {
  const text = String(message || "").toLowerCase();
  const key = String(workflow?.key || "").toLowerCase();
  const name = String(workflow?.name || "").toLowerCase();
  const description = String(workflow?.description || "").toLowerCase();
  const tags = Array.isArray(workflow?.tags) ? workflow.tags.map((tag: any) => String(tag).toLowerCase()) : [];

  let score = 0;
  if (key && text.includes(key)) score += 10;
  if (name && text.includes(name)) score += 10;
  for (const tag of tags) {
    if (tag && text.includes(tag)) score += 4;
  }

  const msgTokens = new Set(tokenizeForWorkflowMatch(text));
  const wfTokens = new Set([
    ...tokenizeForWorkflowMatch(key.replace(/[_\-]+/g, " ")),
    ...tokenizeForWorkflowMatch(name),
    ...tokenizeForWorkflowMatch(description).slice(0, 30),
    ...tags.flatMap((tag: string) => tokenizeForWorkflowMatch(tag)),
  ]);
  for (const token of wfTokens) {
    if (msgTokens.has(token)) score += 1;
  }
  return score;
}

async function inferWorkflowFromMessage(threadId: string, message: string): Promise<string | null> {
  const workflows = await WorkflowService.getAll({ archived: false, enabled: true } as any);
  if (!Array.isArray(workflows) || workflows.length === 0) return null;

  let best: { key: string; score: number } | null = null;
  for (const workflow of workflows) {
    const key = String((workflow as any)?.key || "");
    if (!key) continue;
    const score = workflowMatchScore(message, workflow);
    if (!best || score > best.score) best = { key, score };
  }
  if (!best || best.score < 5) return null;

  const ctxItems = await ContextService.getThreadContext(threadId, { categories: ["workflow_run"], limit: 30 });
  const hasCtx = new Set(
    ctxItems
      .map((item: any) => String(((item?.metadata || {}) as Record<string, unknown>)?.workflowKey || ""))
      .filter(Boolean),
  );
  if (hasCtx.has(best.key)) return best.key;
  return best.key;
}

async function getPendingWorkflowFromRecentAssistantPrompt(threadId: string): Promise<string | null> {
  const messages = await ChatService.getMessages(threadId);
  const lastAssistant = [...messages].reverse().find((message: any) => message.role === "assistant");
  if (!lastAssistant) return null;
  const content = String(lastAssistant.content || "");
  const rawBlocks = (lastAssistant as any)?.blocks;
  const blocks = Array.isArray(rawBlocks)
    ? rawBlocks
    : Array.isArray(rawBlocks?.blocks)
      ? rawBlocks.blocks
      : [];
  const questionPrompts = blocks
    .filter((block: any) => block?.type === "question_mcq")
    .map((block: any) => {
      const prompt = String(block?.prompt || "");
      const optionText = Array.isArray(block?.options)
        ? block.options.map((option: any) => `${String(option?.label || "")} ${String(option?.description || "")}`).join(" ")
        : "";
      return `${prompt} ${optionText}`.trim();
    })
    .filter(Boolean);
  const permissionText = [content, ...questionPrompts].join("\n");
  const hint = extractWorkflowHintFromAssistantText(permissionText);
  if (!hint) return null;

  const asksPermission = /\b(would you like me to|would you like to|do you want me to|do you want to|if you(?:\s*'|’)d like me to|if you would like me to|i(?:\s*'|’)d need to run|need to run|let me know if you(?:'|’)d like me to|should i proceed|can i run|can i fetch|you can fetch it by running|to .* run the|just say the word)\b/i.test(permissionText);
  const indicatesMissingEvidence = /\bINSUFFICIENT_EVIDENCE\b/i.test(permissionText);
  if (!asksPermission && !indicatesMissingEvidence) return null;

  return await resolveWorkflowKeyFromHint(hint);
}

function isLikelyQuestionWorthAnswering(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (isConfirmationLike(trimmed)) return false;
  if (RERUN_NOW_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  if (USE_CACHED_PATTERNS.some((pattern) => pattern.test(trimmed))) return false;
  if (isExecutionCommand(trimmed) || isDataFetchCommand(trimmed)) return false;
  return trimmed.length >= 8;
}

/**
 * Resolves the best user question to pair with an explicit rerun command.
 *
 * @remarks
 * If the current turn is command-like, this walks backward to find the most
 * recent substantive user question in the thread.
 */
export async function resolveQuestionForRerun(threadId: string, currentMessage: string): Promise<string | null> {
  if (isLikelyQuestionWorthAnswering(currentMessage)) {
    return currentMessage.trim();
  }

  const messages = await ChatService.getMessages(threadId);
  const priorUser = [...messages]
    .reverse()
    .find((message: any) => message.role === "user" && isLikelyQuestionWorthAnswering(String(message.content || "")));

  return priorUser ? String(priorUser.content || "").trim() : null;
}

async function getPreferredWorkflowFromRecentAssistantSource(threadId: string): Promise<string | null> {
  const messages = await ChatService.getMessages(threadId);
  const latestAssistant = [...messages].reverse().find((message: any) => message.role === "assistant");
  if (!latestAssistant) return null;
  const rawBlocks = (latestAssistant as any)?.blocks;
  const blocks = Array.isArray(rawBlocks)
    ? rawBlocks
    : Array.isArray(rawBlocks?.blocks)
      ? rawBlocks.blocks
      : [];
  for (const block of blocks) {
    if (!block || block.type !== "source") continue;
    const metadata = Array.isArray((block as any).metadata) ? (block as any).metadata as string[] : [];
    const workflowMeta = metadata.find((entry) => /^workflow:\s*/i.test(String(entry)));
    if (workflowMeta) {
      const value = String(workflowMeta).replace(/^workflow:\s*/i, "").trim();
      if (value) return value;
    }
  }
  return null;
}

async function detectFollowUp(threadId: string, message: string): Promise<FollowUpResult> {
  if (!contextConfig.enabled) return { detected: false };

  const msg = message.trim();

  if (RETRY_PATTERNS.some((pattern) => pattern.test(msg))) {
    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      const meta = lastCtx.metadata as Record<string, unknown> | null;
      const workflowKey = meta?.workflowKey as string;
      if (workflowKey) {
        logger.info({ scope: "orchestrator", message: `Follow-up detected: retry -> ${workflowKey}`, threadId, workflowKey });
        return { detected: true, action: "retry", workflowKey };
      }
    }
  }

  if (CONFIRMATION_PATTERNS.some((pattern) => pattern.test(msg))) {
    const pendingWorkflowKey = await getPendingWorkflowFromRecentAssistantPrompt(threadId);
    if (pendingWorkflowKey) {
      logger.info({ scope: "orchestrator", message: `Follow-up detected: confirmation prompt -> ${pendingWorkflowKey}`, threadId, workflowKey: pendingWorkflowKey });
      return { detected: true, action: "retry", workflowKey: pendingWorkflowKey };
    }
  }

  if (isDataFetchCommand(msg)) {
    const pendingWorkflowKey = await getPendingWorkflowFromRecentAssistantPrompt(threadId);
    if (pendingWorkflowKey) {
      logger.info({ scope: "orchestrator", message: `Follow-up detected: data-fetch -> ${pendingWorkflowKey}`, threadId, workflowKey: pendingWorkflowKey });
      return { detected: true, action: "retry", workflowKey: pendingWorkflowKey };
    }
  }

  if (SHOW_PREVIOUS_PATTERNS.some((pattern) => pattern.test(msg))) {
    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      logger.info({ scope: "orchestrator", message: "Follow-up detected: show_previous", threadId });
      return { detected: true, action: "show_previous", contextItem: lastCtx };
    }
  }

  const entityMatch = msg.match(/\b(?:what\s+(?:about|is|are|was|were)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:tell\s+me\s+(?:about|more\s+about)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:show\s+(?:me\s+)?(?:the|my)?\s*)(.+?)(?:\s+(?:from|in)\s+(?:the|that|last)\s+(?:result|output|workflow))?$/i);

  if (entityMatch) {
    const query = entityMatch[1].trim().replace(/[?.!]+$/, "");
    if (query.length >= 3 && query.length <= 100) {
      const results = await ContextService.searchContext(threadId, query, 3);
      if (results.length > 0) {
        logger.info({ scope: "orchestrator", message: `Follow-up detected: entity_search "${query}" (${results.length})`, threadId });
        return { detected: true, action: "entity_search", query, results };
      }
    }
  }

  return { detected: false };
}

/**
 * Classifies a user turn into deterministic follow-up routing categories.
 *
 * @param threadId - Conversation thread identifier.
 * @param message - Current user message.
 * @returns Classified follow-up route used by orchestrator flow control.
 *
 * @example
 * ```ts
 * const route = await classifyFollowUpRoute(threadId, 'run now');
 * if (route.kind === 'explicit_rerun') {
 *   // Dispatch selected workflow again.
 * }
 * ```
 */
export async function classifyFollowUpRoute(threadId: string, message: string): Promise<FollowUpRoute> {
  if (!contextConfig.enabled) return { kind: "none" };

  const msg = message.trim();
  const followUp = await detectFollowUp(threadId, msg);

  if (followUp.detected && followUp.action === "show_previous") {
    return { kind: "show_previous", contextItem: followUp.contextItem };
  }

  if (followUp.detected && followUp.action === "retry") {
    return { kind: "explicit_rerun", workflowKey: followUp.workflowKey };
  }

  const lastCtx = await ContextService.getLastWorkflowContext(threadId);
  if (!lastCtx) return { kind: "none" };
  const meta = (lastCtx.metadata || {}) as Record<string, unknown>;
  const workflowKeyFromLastContext = String(meta.workflowKey || "");
  const workflowKeyFromAssistantSource = await getPreferredWorkflowFromRecentAssistantSource(threadId);
  const workflowKey = workflowKeyFromAssistantSource || workflowKeyFromLastContext;
  if (!workflowKey) return { kind: "none" };

  let routeContextItem: any = lastCtx;
  if (workflowKeyFromAssistantSource && workflowKeyFromAssistantSource !== workflowKeyFromLastContext) {
    const window = await ContextService.getThreadContext(threadId, { categories: ["workflow_run"], limit: 12 });
    const preferredItem = window.find((item: any) => {
      const key = String((((item?.metadata || {}) as Record<string, unknown>).workflowKey) || "");
      return key === workflowKeyFromAssistantSource;
    });
    if (preferredItem) routeContextItem = preferredItem;
  }

  if (!isExecutionCommand(msg) && isLikelyFollowUpQuestion(msg)) {
    const inferredWorkflowKey = await inferWorkflowFromMessage(threadId, msg);
    if (inferredWorkflowKey && inferredWorkflowKey !== workflowKey) {
      logger.info({ scope: "orchestrator", message: `Cross-workflow auto-switch: ${workflowKey} -> ${inferredWorkflowKey}`, threadId, workflowKey: inferredWorkflowKey });
      return {
        kind: "explicit_rerun",
        workflowKey: inferredWorkflowKey,
        autoSwitched: true,
        contextWorkflow: workflowKey,
      };
    }
  }

  if (RERUN_NOW_PATTERNS.some((pattern) => pattern.test(msg))) {
    return { kind: "explicit_rerun", workflowKey };
  }
  if (USE_CACHED_PATTERNS.some((pattern) => pattern.test(msg))) {
    return { kind: "use_cached_choice", workflowKey, contextItem: routeContextItem };
  }

  if (!isExecutionCommand(msg) && isLikelyFollowUpQuestion(msg)) {
    return { kind: "followup_answer", workflowKey, contextItem: routeContextItem };
  }

  return { kind: "none" };
}
