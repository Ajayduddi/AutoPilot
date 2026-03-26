import { JSX, Show } from "solid-js";

export function Card(props: { children: JSX.Element; class?: string; title?: string }) {
  return (
    <div class={`bg-neutral-800 border border-neutral-700/50 rounded-xl overflow-hidden shadow-sm ${props.class || ""}`}>
      <Show when={props.title}>
        <div class="px-4 py-3 border-b border-neutral-700/50 flex items-center justify-between bg-neutral-850/50">
          <h3 class="font-medium text-sm text-neutral-200">{props.title}</h3>
        </div>
      </Show>
      <div class="p-4">
        {props.children}
      </div>
    </div>
  );
}
