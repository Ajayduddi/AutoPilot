import type { QuestionMcqBlock } from "../types";

/**
 * Heuristic that detects proceed/continue style prompts for compact rendering.
 *
 * @param block - MCQ block payload.
 * @returns `true` when prompt/options look like workflow proceed confirmation.
 */
export function isWorkflowProceedPrompt(block: QuestionMcqBlock): boolean {
  const prompt = String(block.prompt || "").toLowerCase();
  const options = Array.isArray(block.options) ? block.options : [];
  const combined = options
    .map((opt) => `${String(opt.label || "")} ${String(opt.valueToSend || "")}`.toLowerCase())
    .join(" | ");
  const promptLooksLikeProceed =
    /\b(workflow|run|proceed|continue|action)\b/.test(prompt) &&
    /\b(choose|continue|proceed|run)\b/.test(prompt);
  const optionsLookLikeProceed =
    /\b(approve|run|proceed|yes)\b/.test(combined) &&
    /\b(not now|later|skip|cancel|no)\b/.test(combined);
  return promptLooksLikeProceed || optionsLookLikeProceed;
}
