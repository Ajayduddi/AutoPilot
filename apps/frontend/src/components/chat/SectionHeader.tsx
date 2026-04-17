/**
 * @fileoverview apps/frontend/src/components/chat/SectionHeader.tsx
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
/**
 * Interface describing section header props shape.
 */
interface SectionHeaderProps {
  title: string;
  divider?: boolean;
}

/**
 * Utility function to section header.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for SectionHeader.
 * @returns Return value from SectionHeader.
 *
 * @example
 * ```typescript
 * const output = SectionHeader(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SectionHeader(props: SectionHeaderProps) {
  return (
    <div class={props.divider ? "pb-2 border-b border-neutral-800/70" : "pb-1"}>
      <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">{props.title}</p>
    </div>
  );
}
