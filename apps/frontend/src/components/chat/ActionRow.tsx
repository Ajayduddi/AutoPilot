import { For, Show, createSignal } from "solid-js";
import type { ActionItem } from "./types";

/**
 * Interface describing action row props shape.
 */
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
 * Utility function to spinner.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from Spinner.
 *
 * @example
 * ```typescript
 * const output = Spinner();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
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
 * Utility function to action row.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for ActionRow.
 * @returns Return value from ActionRow.
 *
 * @example
 * ```typescript
 * const output = ActionRow(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
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
