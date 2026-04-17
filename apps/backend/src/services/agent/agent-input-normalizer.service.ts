/**
 * @fileoverview apps/backend/src/services/agent/agent-input-normalizer.service.ts
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

export type AgentInputNormalization = {
  normalizedContent: string;
  slashWorkflowKey?: string;
  pendingWorkflowKey?: string;
  priorUserGoal?: string;
};

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
    /running\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
    /(?:run|execute|trigger)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i,
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

export async function normalizeInputForAgent(threadId: string, content: string): Promise<AgentInputNormalization> {
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
