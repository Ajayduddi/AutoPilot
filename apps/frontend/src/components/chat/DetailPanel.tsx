/**
 * @fileoverview apps/frontend/src/components/chat/DetailPanel.tsx
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
import { For, Show } from "solid-js";

/**
 * Interface describing detail panel props shape.
 */
interface DetailPanelProps {
  title?: string;
  description?: string;
  metadata?: Record<string, string>;
}

/**
 * Utility function to detail panel.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for DetailPanel.
 * @returns Return value from DetailPanel.
 *
 * @example
 * ```typescript
 * const output = DetailPanel(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function DetailPanel(props: DetailPanelProps) {
  const entries = () => Object.entries(props.metadata || {});

  return (
    <div class="space-y-5">
      <Show when={props.title}>
        <div>
          <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Overview</p>
          <h3 class="mt-2 text-base font-semibold text-neutral-100">{props.title}</h3>
          <Show when={props.description}>
            <p class="mt-2 text-sm text-neutral-300 leading-relaxed">{props.description}</p>
          </Show>
        </div>
      </Show>

      <Show when={entries().length > 0}>
        <div class="space-y-2">
          <p class="text-[10px] uppercase tracking-[0.16em] text-neutral-500 font-semibold">Details</p>
          <div class="rounded-xl border border-neutral-800/70 divide-y divide-neutral-800/70 bg-neutral-900/60">
            <For each={entries()}>
              {([key, value]) => (
                <div class="px-3 py-2.5 flex items-start justify-between gap-4">
                  <span class="text-xs text-neutral-500 capitalize">{key.replace(/_/g, " ")}</span>
                  <span class="text-xs text-neutral-200 text-right break-all">{value}</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
