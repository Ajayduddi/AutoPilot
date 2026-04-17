/**
 * @fileoverview apps/frontend/src/components/chat/SummaryBlock.tsx
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
import { For, createSignal, Show } from "solid-js";

/**
 * Interface describing summary block props shape.
 */
interface SummaryBlockProps {
  title?: string;
  items: string[];
}

/**
 * Utility function to summary block.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for SummaryBlock.
 * @returns Return value from SummaryBlock.
 *
 * @example
 * ```typescript
 * const output = SummaryBlock(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SummaryBlock(props: SummaryBlockProps) {
  const [expanded, setExpanded] = createSignal(false);
  const preview = () => (props.items[0] || "").slice(0, 120);

  return (
    <button
      onClick={() => setExpanded((v) => !v)}
      class="w-full text-left rounded-xl bg-neutral-900/50 border border-neutral-800/50 px-3.5 py-2.5 transition-colors hover:bg-neutral-900/70 group/summary"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-500 font-semibold shrink-0">{props.title || "Summary"}</p>
          <Show when={!expanded()}>
            <p class="text-xs text-neutral-400 truncate">{preview()}</p>
          </Show>
        </div>
        <svg
          class={`w-3.5 h-3.5 text-neutral-500 shrink-0 transition-transform duration-200 ${expanded() ? "rotate-180" : ""}`}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
      <Show when={expanded()}>
        <ol class="mt-2 space-y-1 text-sm text-neutral-300 list-decimal pl-4">
          <For each={props.items}>{(item) => <li>{item}</li>}</For>
        </ol>
      </Show>
    </button>
  );
}
