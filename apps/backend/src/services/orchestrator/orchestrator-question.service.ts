/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-question.service.ts
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
import { isInteractiveQuestionEnforced } from "../../config/runtime.config";

type StreamBlock = { type: string; [key: string]: any };

function makeQuestionId(prefix = "q"): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

export function extractWorkflowHintFromAssistantText(text: string): string | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const patterns = [
    /\b(?:run|execute|trigger|rerun|retry|proceed with)\s+(?:the\s+)?([a-z0-9 _-]+?)\s+workflow\b/i,
    /\bworkflow\s+["'`]?([a-z0-9 _-]+?)["'`]?(?:\s|[?.!]|$)/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = String(match?.[1] || "").trim();
    if (value) return value;
  }
  return null;
}

function capitalizeChoiceLabel(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) return normalized;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function extractNaturalChoicePromptLine(text: string): { line: string; options: string[] } | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const tailLine = lines[lines.length - 1] || "";
  const cuePattern =
    /\b(?:would you like|do you want|should i|shall i|can i|could i|i can|i could|choose|pick|select)\b/gi;
  let cueIndex = -1;
  for (const match of tailLine.matchAll(cuePattern)) {
    if (typeof match.index === "number") cueIndex = match.index;
  }
  const tail = (cueIndex >= 0 ? tailLine.slice(cueIndex) : tailLine).trim();
  if (tail.length > 220) return null;

  const patterns = [
    /^(?:would you like|do you want|should i|shall i|can i|could i)\s+(?:me to\s+|a\s+|an\s+)?(.+?)\?$/i,
    /^(?:i can|i could)\s+(.+?)(?:\s+if you'd like)?[?.]?$/i,
    /^(?:choose|pick|select)(?:\s+one|\s+an option|\s+between)?[:\-]?\s*(.+?)[?.]?$/i,
  ];

  let body = "";
  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (match?.[1]) {
      body = String(match[1]).trim();
      break;
    }
  }
  if (!body) return null;

  const normalizedBody = stripInlineMarkdown(body)
    .replace(/\s+(please|now)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedBody) return null;

  const choiceBody = /\b(?:or|and)\b/i.test(normalizedBody)
    ? normalizedBody.replace(/\s*,\s*/g, "|")
    : normalizedBody;

  const optionCandidates = choiceBody
    .replace(/\s+or\s+/gi, "|")
    .replace(/\s+and\s+/gi, "|")
    .replace(/\s*\/\s*/g, "|")
    .split("|")
    .map((option) =>
      option
        .replace(/^(either|maybe|just)\s+/i, "")
        .replace(/^(or|and)\s+/i, "")
        .replace(/^(a|an)\s+/i, "")
        .trim(),
    )
    .filter(Boolean);

  const options = [...new Set(optionCandidates)];
  if (options.length < 2 || options.length > 3) return null;
  if (options.some((option) => option.length > 80)) return null;

  return { line: tail, options };
}

function parseQuestionMcqFromText(text: string): StreamBlock | null {
  const raw = (text || "").trim();
  if (!raw) return null;

  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  const options: Array<{ id: string; label: string; valueToSend: string; description?: string }> = [];
  let firstOptionLineIdx = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^(\d+)[\).\:-]\s*(.+)$/);
    if (!match) continue;
    if (firstOptionLineIdx === -1) firstOptionLineIdx = i;
    const idx = Number(match[1]);
    const body = stripInlineMarkdown(match[2]);
    if (!body) continue;
    const [left, right] = body.split(/\s+—\s+|\s+-\s+/, 2);
    const label = stripInlineMarkdown(left || body);
    const valueLower = label.toLowerCase();
    let valueToSend = label;
    if (valueLower.includes("use old")) valueToSend = "use old";
    else if (valueLower.includes("rerun") || valueLower.includes("retry") || valueLower.includes("run again")) valueToSend = "rerun now";
    options.push({
      id: `opt_${idx}`,
      label,
      valueToSend,
      description: right ? stripInlineMarkdown(right) : undefined,
    });
  }

  if (options.length < 2 || firstOptionLineIdx === -1) return null;

  const promptLines = lines.slice(0, firstOptionLineIdx);
  const prompt = stripInlineMarkdown(promptLines.join(" "));
  if (!prompt) return null;
  const hasActionableOptions = options.some((option) => isActionableQuestionOption(option.label));
  if (!hasActionableOptions && !isActionableQuestionPrompt(prompt)) return null;

  return {
    type: "question_mcq",
    questionId: makeQuestionId("mcq"),
    prompt,
    options,
    allowFreeText: false,
  };
}

function parseProceedQuestionFromText(text: string): StreamBlock | null {
  const raw = (text || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+/g, " ");
  const asksForChoice =
    /\b(would you like|do you want|should i|can i|could i|shall i|let me know if you(?:'|’)d like)\b/i.test(normalized);
  const executionVerb =
    /\b(run|execute|trigger|rerun|retry|refresh|rescan|scan|fetch|start|launch|proceed)\b/i.test(normalized);
  const executionTarget =
    /\b(workflow|action|automation|task|run)\b/i.test(normalized);
  const nonExecutionHelp =
    /\b(format|rephrase|rewrite|shorten|length|tone|style|anything else|help with anything else|wording)\b/i.test(normalized);

  const asksToProceed = asksForChoice && executionVerb && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(normalized));
  if (nonExecutionHelp && !executionTarget) return null;
  if (!asksToProceed) return null;

  const workflowHint = extractWorkflowHintFromAssistantText(raw);
  const prompt = workflowHint
    ? `I can run the ${workflowHint} workflow now. Choose how you want to continue:`
    : "I can proceed with the requested workflow action. Choose how you want to continue:";

  return {
    type: "question_mcq",
    questionId: makeQuestionId("proceed"),
    prompt,
    options: [
      {
        id: "proceed_approve",
        label: "Approve and run",
        valueToSend: "yes proceed",
        description: "Run the workflow now.",
        recommended: true,
      },
      {
        id: "proceed_no",
        label: "Not now",
        valueToSend: "no",
        description: "Keep current context without running.",
      },
    ],
    allowFreeText: false,
  };
}

function parseBinaryChoiceQuestionFromText(text: string): StreamBlock | null {
  const parsed = extractNaturalChoicePromptLine(text);
  if (!parsed) return null;

  return {
    type: "question_mcq",
    questionId: makeQuestionId("choice"),
    prompt: "Choose how you want to continue:",
    options: parsed.options.map((option, index) => ({
      id: `choice_${index + 1}`,
      label: capitalizeChoiceLabel(option),
      valueToSend: option,
      ...(index === 0 ? { recommended: true } : {}),
    })),
    allowFreeText: false,
  };
}

export function stripTrailingQuestionPrompt(text: string): string {
  const raw = String(text || "").trim();
  if (!raw) return raw;
  const lines = raw.split("\n");
  const lastLine = String(lines[lines.length - 1] || "").trim();
  const parsed = extractNaturalChoicePromptLine(lastLine);
  if (parsed?.line && parsed.line === lastLine) {
    return lines.slice(0, -1).join("\n").trim();
  }
  return raw;
}

export function buildQuestionFromText(text: string): StreamBlock | null {
  return parseQuestionMcqFromText(text) || parseProceedQuestionFromText(text) || parseBinaryChoiceQuestionFromText(text);
}

export function shouldForceInteractiveQuestion(text: string): boolean {
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

export function buildForcedProceedQuestion(text: string): StreamBlock {
  const hint = extractWorkflowHintFromAssistantText(text);
  return {
    type: "question_mcq",
    questionId: makeQuestionId("forced"),
    prompt: hint
      ? `I can run the ${hint} workflow now. Choose how you want to continue:`
      : "Choose how you want to continue:",
    options: [
      {
        id: "forced_approve",
        label: "Approve and run",
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
