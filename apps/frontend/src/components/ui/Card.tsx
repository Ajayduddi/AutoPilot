/**
 * @fileoverview Reusable card primitives for consistent panel containers.
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
import { JSX, Show } from "solid-js";

/**
 * Reusable card container with optional header title and content region.
 */
export function Card(props: { children: JSX.Element; class?: string; title?: string }) {
  return (
    <div class={`bg-neutral-900/40 backdrop-blur-sm border border-neutral-800/60 rounded-2xl overflow-hidden shadow-sm ${props.class || ""}`}>
      <Show when={props.title}>
        <div class="px-5 py-4 border-b border-neutral-800/60 flex items-center justify-between bg-white/[0.01]">
          <h3 class="font-medium text-sm text-neutral-200">{props.title}</h3>
        </div>
      </Show>
      <div class="p-5">
        {props.children}
      </div>
    </div>
  );
}
