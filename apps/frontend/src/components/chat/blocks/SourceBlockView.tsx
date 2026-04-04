import { For, Show, createSignal } from "solid-js";

/**
 * Interface describing source block view props shape.
 */
interface SourceBlockViewProps {
  origin?: string;
  actor?: string;
  title?: string;
  userMetadata: string[];
  debugMetadata: string[];
}

/**
 * Utility function to source block view.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for SourceBlockView.
 * @returns Return value from SourceBlockView.
 *
 * @example
 * ```typescript
 * const output = SourceBlockView(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SourceBlockView(props: SourceBlockViewProps) {
  const [showDebug, setShowDebug] = createSignal(false);
  const [showAllMeta, setShowAllMeta] = createSignal(false);
  const visibleLimit = 4;
  const visibleUserMeta = () => (showAllMeta() ? props.userMetadata : props.userMetadata.slice(0, visibleLimit));
  const hiddenUserMetaCount = () => Math.max(0, props.userMetadata.length - visibleLimit);

  return (
    <section class="block-enter rounded-lg bg-neutral-900/30 border border-neutral-800/40 px-3.5 py-2 text-xs">
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <p class="text-[10px] uppercase tracking-[0.12em] text-neutral-500 font-semibold shrink-0">
            {props.title || "Source"}
          </p>
          <Show when={props.origin}>
            <span class="text-neutral-400 truncate">— {props.origin}</span>
          </Show>
          <Show when={props.actor}>
            <span class="text-neutral-500">({props.actor})</span>
          </Show>
        </div>
        <Show when={props.debugMetadata.length > 0}>
          <button
            onClick={() => setShowDebug((v) => !v)}
            class="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors shrink-0"
          >
            {showDebug() ? "Hide details" : "Details"}
          </button>
        </Show>
      </div>
      <Show when={props.userMetadata.length > 0}>
        <div class="flex flex-wrap items-center gap-1 mt-1.5">
          <For each={visibleUserMeta()}>
            {(item) => (
              <span class="text-[10px] text-neutral-400 bg-neutral-800/50 px-1.5 py-0.5 rounded max-w-[220px] truncate">{item}</span>
            )}
          </For>
          <Show when={!showAllMeta() && hiddenUserMetaCount() > 0}>
            <button
              onClick={() => setShowAllMeta(true)}
              class="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors px-1.5 py-0.5 rounded bg-neutral-800/40"
            >
              +{hiddenUserMetaCount()} more
            </button>
          </Show>
          <Show when={showAllMeta() && hiddenUserMetaCount() > 0}>
            <button
              onClick={() => setShowAllMeta(false)}
              class="text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors px-1.5 py-0.5 rounded bg-neutral-800/40"
            >
              Show less
            </button>
          </Show>
        </div>
      </Show>
      <Show when={showDebug() && props.debugMetadata.length > 0}>
        <div class="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-neutral-800/40">
          <For each={props.debugMetadata}>
            {(item) => (
              <span class="text-[10px] text-neutral-500 bg-neutral-800/40 px-1.5 py-0.5 rounded font-mono">{item}</span>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
