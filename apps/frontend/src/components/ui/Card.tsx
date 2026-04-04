import { JSX, Show } from "solid-js";

/**
 * Utility function to card.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for Card.
 * @returns Return value from Card.
 *
 * @example
 * ```typescript
 * const output = Card(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
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
