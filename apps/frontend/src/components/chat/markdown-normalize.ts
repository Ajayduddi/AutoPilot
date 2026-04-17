/**
 * @fileoverview apps/frontend/src/components/chat/markdown-normalize.ts
 *
 * High-level purpose:
 * Reusable frontend presentation module for rendering chat, settings, and UI primitives across routes.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable UI logic behind typed component contracts.
 * - Supports composable view patterns with minimal route coupling.
 * - Balances readability and flexibility for evolving product surfaces.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import the component into route or parent composition layers.
 * 2. Pass required typed props and wire callbacks to domain actions.
 * 3. Confirm visual and interaction behavior with component tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { formatCommonAnswerMarkdown } from "@autopilot/shared";

export function normalizeFencedHtmlBlocks(markdown: string): string {
  return markdown.replace(/```(html|xml|xhtml|jsx|tsx)[^\n]*\r?\n([\s\S]*?)```/gi, (full, _lang, body) => {
    const normalizedBody = String(body).replace(/>([ \t]*)<\//g, ">\n</");
    return full.replace(body, normalizedBody);
  });
}

export function normalizeLooseListMarkdown(markdown: string): string {
  const parts = String(markdown || "").split(/(```[\s\S]*?```)/g);
  return parts
    .map((part) => {
      if (part.startsWith("```")) return part;
      return formatCommonAnswerMarkdown(part.replace(/\r\n/g, "\n"));
    })
    .join("");
}
