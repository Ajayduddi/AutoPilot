import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { usePanel } from "../../context/panel.context";
const PANEL_WIDTH_KEY = "autopilot:right-panel-width";
const DEFAULT_WIDTH = 384;
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;

/**
 * Utility function to clamp width.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param value - Input value for clampWidth.
 * @returns Return value from clampWidth.
 *
 * @example
 * ```typescript
 * const output = clampWidth(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function clampWidth(value: number) {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

/**
 * Utility function to right panel.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from RightPanel.
 *
 * @example
 * ```typescript
 * const output = RightPanel();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function RightPanel() {
  const { panel, closePanel } = usePanel();
  const [panelWidth, setPanelWidth] = createSignal(DEFAULT_WIDTH);
  /**
   * isResizing variable.
   */
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

  const [isMobile, setIsMobile] = createSignal(false);

  onMount(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setPanelWidth(clampWidth(stored));
    }
    
    // Check mobile breakpoint initially and on resize
    const checkViewport = () => setIsMobile(window.innerWidth < 1024);
    checkViewport();
    window.addEventListener("resize", checkViewport);
    
    // We add the cleanup for resize inside the component scope or onCleanup
    // but onCleanup is called below, so we'll just move the listener removal there
  });

  onCleanup(() => {
    stopResize();
    window.removeEventListener("resize", () => setIsMobile(window.innerWidth < 1024)); // Note: this is a different reference. A named function is better.
  });

  return (
    <Show when={panel()}>
      {(p) => (
        <Show 
          when={isMobile()} 
          fallback={
            /* ── Desktop: resizable side panel ── */
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

              <aside class="w-full h-full flex flex-col border-l border-neutral-800/20 bg-[#0c0c0c] min-h-0">
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
                <div class="flex-1 overflow-y-auto p-5 scrollbar-custom min-h-0">
                  {(p() as any).content}
                </div>
              </aside>
            </div>
          }
        >
          {/* ── Mobile: bottom sheet ── */}
          <div class="lg:hidden fixed inset-0 z-[80]">
            {/* Backdrop */}
            <div
              class="absolute inset-0 bg-black/60 backdrop-blur-sm animate-sheet-overlay"
              onClick={closePanel}
              aria-label="Close panel"
            />

            {/* Sheet */}
            <div class="absolute bottom-0 left-0 right-0 animate-sheet-up flex flex-col bg-[#131314] border-t border-neutral-800/50 rounded-t-2xl shadow-2xl shadow-black/80 max-h-[88vh]"
              style={{ "padding-bottom": "max(1rem, env(safe-area-inset-bottom))" }}
            >
              {/* Drag handle */}
              <div class="flex justify-center pt-3 pb-1 shrink-0">
                <div class="w-10 h-1 rounded-full bg-neutral-700/60" />
              </div>

              {/* Header */}
              <div class="flex items-center justify-between px-5 py-3 border-b border-neutral-800/40 shrink-0">
                <h2 class="text-[15px] font-semibold text-neutral-100 tracking-tight truncate pr-4">{p().title}</h2>
                <button
                  onClick={closePanel}
                  class="flex items-center justify-center min-w-[40px] min-h-[40px] rounded-xl text-neutral-500 hover:text-neutral-200 hover:bg-white/5 active:bg-white/10 transition-all duration-200 shrink-0"
                  aria-label="Close panel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>

              {/* Scrollable content */}
              <div class="flex-1 overflow-y-auto overscroll-contain px-5 py-4 min-h-0">
                {(p() as any).content}
              </div>
            </div>
          </div>
        </Show>
      )}
    </Show>
  );
}
