import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { usePanel } from "../../context/panel.context";

const PANEL_WIDTH_KEY = "autopilot:right-panel-width";
const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;

function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

export function RightPanel() {
  const { panel, closePanel } = usePanel();
  const [panelWidth, setPanelWidth] = createSignal(DEFAULT_WIDTH);
  let isResizing = false;
  let startX = 0;
  let startWidth = DEFAULT_WIDTH;

  const stopResize = () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth()));
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResize);
  };

  const onMouseMove = (event: MouseEvent) => {
    if (!isResizing) return;
    const delta = startX - event.clientX;
    setPanelWidth(clampWidth(startWidth + delta));
  };

  const startResize = (event: MouseEvent) => {
    event.preventDefault();
    isResizing = true;
    startX = event.clientX;
    startWidth = panelWidth();
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResize);
  };

  onMount(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setPanelWidth(clampWidth(stored));
    }
  });

  onCleanup(() => {
    stopResize();
  });

  return (
    <Show when={panel()}>
      {(p) => (
        <div class="hidden lg:flex relative shrink-0 animate-panel-slide-in" style={{ width: `${panelWidth()}px` }}>
          <div
            class="absolute left-0 top-0 h-full w-2 cursor-col-resize z-20 group"
            onMouseDown={startResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
          >
            <div class="mx-auto h-full w-[2px] bg-transparent group-hover:bg-blue-400/40 transition-colors duration-150" />
          </div>

          <aside class="w-full flex flex-col border-l border-neutral-800/20 bg-[#0c0c0c]">
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
        </div>
      )}
    </Show>
  );
}
