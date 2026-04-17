/**
 * @fileoverview apps/backend/src/services/agent/agent-question.service.ts
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

function buildQuestionId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseAgentQuestionBlock(text: string): StreamBlock | null {
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
      questionId: buildQuestionId(),
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

  const proceedLike = asksForChoice
    && executionVerb
    && (executionTarget || /\b(run|execute|trigger|rerun|retry|fetch)\b/i.test(raw));

  if (nonExecutionHelp && !executionTarget) return null;
  if (!proceedLike) return null;

  return {
    type: "question_mcq",
    questionId: buildQuestionId(),
    prompt: "Choose how you want to continue:",
    options: [
      { id: "yes_proceed", label: "Yes, proceed", valueToSend: "yes proceed", description: "Run the workflow now.", recommended: true },
      { id: "not_now", label: "Not now", valueToSend: "no", description: "Keep current context without running." },
    ],
    allowFreeText: false,
  };
}

export function shouldForceAgentQuestion(text: string): boolean {
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

export function buildForcedAgentQuestion(text: string): StreamBlock {
  const hintMatch = String(text || "")
    .replace(/\*\*/g, "")
    .match(/(?:run|execute|trigger|fetch)\s+(?:the\s+)?["'`]?([a-zA-Z0-9._\-\s]+?)["'`]?\s+workflow/i);
  const hint = hintMatch?.[1]?.trim();

  return {
    type: "question_mcq",
    questionId: buildQuestionId(),
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
