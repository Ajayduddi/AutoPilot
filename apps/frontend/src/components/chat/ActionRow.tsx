/**
 * @fileoverview Renders contextual action buttons under assistant messages.
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
import { For, Show, createSignal } from "solid-js";
import type { ActionItem } from "./types";

interface ActionRowProps {
  items: ActionItem[];
  onAction?: (action: ActionItem) => void | Promise<void>;
}
const variantClass: Record<NonNullable<ActionItem["variant"]>, string> = {
  primary:   "bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/35 hover:border-blue-400/50",
  secondary: "bg-emerald-600/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-600/25",
  ghost:     "bg-transparent text-neutral-300 border border-neutral-700 hover:border-neutral-500 hover:text-neutral-100",
  danger:    "bg-red-600/15 text-red-300 border border-red-500/25 hover:bg-red-600/25",
};

/**
 * Compact spinner icon used while an action is being executed.
 */
function Spinner() {
  return (
    <svg class="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

/**
 * Renders a row of actionable assistant controls with built-in loading lock.
 *
 * @remarks
 * Only one action can run at a time. While one action is pending, all others
 * are disabled to prevent duplicate submissions.
 *
 * @example
 * ```tsx
 * <ActionRow
 *   items={[{ id: "retry", label: "Retry", variant: "secondary" }]}
 *   onAction={async (item) => handleAction(item.id)}
 * />
 * ```
 */
export function ActionRow(props: ActionRowProps) {
  const [loadingId, setLoadingId] = createSignal<string | null>(null);
  const handleClick = async (item: ActionItem) => {
    if (item.disabled || item.loading || loadingId()) return;
    if (!props.onAction) return;
    setLoadingId(item.id);
    try {
      await props.onAction(item);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div class="flex flex-wrap gap-2">
      <For each={props.items}>
        {(item) => {
          const isLoading = () => item.loading || loadingId() === item.id;
          const isDisabled = () => item.disabled || isLoading() || (loadingId() !== null && loadingId() !== item.id);
          return (
            <button
              onClick={() => handleClick(item)}
              disabled={isDisabled()}
              class={`inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 min-h-[32px] rounded-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50
                ${variantClass[item.variant ?? "ghost"]}
                ${isDisabled() ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <Show when={isLoading()}>
                <Spinner />
              </Show>
              {item.label}
            </button>
          );
        }}
      </For>
    </div>
  );
}
