import { Show } from "solid-js";
import { usePanel } from "../../context/panel.context";

export function RightPanel() {
  const { panel, closePanel } = usePanel();

  return (
    <Show when={panel()}>
      {(p) => (
        <aside class="hidden lg:flex w-80 xl:w-96 flex-col shrink-0 border-l border-neutral-800/20 bg-[#0c0c0c] animate-panel-slide-in">
          <header class="px-5 py-4 border-b border-neutral-800/20 flex justify-between items-center shrink-0">
            <h2 class="text-[14px] font-medium text-neutral-200 tracking-tight truncate pr-4">{p().title}</h2>
            <button
              onClick={closePanel}
              class="p-1.5 rounded-lg text-neutral-600 hover:text-neutral-200 hover:bg-white/5 transition-all duration-200 shrink-0"
              aria-label="Close panel"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </header>
          <div class="flex-1 overflow-y-auto p-5 scrollbar-custom">
            {(p() as any).content}
          </div>
        </aside>
      )}
    </Show>
  );
}
