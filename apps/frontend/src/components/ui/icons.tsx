/**
 * @fileoverview apps/frontend/src/components/ui/icons.tsx
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
  * icon props type alias.
  */
type IconProps = {
  class?: string;
};

/**
 * Utility function to shield check icon.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for ShieldCheckIcon.
 * @returns Return value from ShieldCheckIcon.
 *
 * @example
 * ```typescript
 * const output = ShieldCheckIcon(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={`block ${props.class ?? ""}`.trim()}
    >
      <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9c-4.5-.5-8-4-8-9V7l8-4z" />
      <path d="M9 12l2 2l4-4" />
    </svg>
  );
}

/**
 * Utility function to workflow icon.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for WorkflowIcon.
 * @returns Return value from WorkflowIcon.
 *
 * @example
 * ```typescript
 * const output = WorkflowIcon(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function WorkflowIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={`block ${props.class ?? ""}`.trim()}
    >
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
