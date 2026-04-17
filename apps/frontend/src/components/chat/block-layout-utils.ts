/**
 * @fileoverview apps/frontend/src/components/chat/block-layout-utils.ts
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
export function shouldUseScrollableContentBlock(value: string): boolean {
  const text = String(value || "").trim();
  if (!text) return false;

  const lineCount = text.split(/\r?\n/).length;
  const headingCount = (text.match(/^#{1,6}\s/mg) || []).length;
  const bulletCount = (text.match(/^(?:- |\* |\d+\. )/mg) || []).length;
  const hasFence = /```[\s\S]*?```/.test(text);
  const hasTable = /^\|.+\|$/m.test(text);

  return (
    text.length >= 1600 ||
    lineCount >= 26 ||
    headingCount >= 4 ||
    bulletCount >= 10 ||
    hasFence ||
    hasTable
  );
}
