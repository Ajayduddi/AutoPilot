import { createSignal, For, Show, JSX, onCleanup, onMount } from "solid-js";

/**
 * Interface describing select option shape.
 */
export interface SelectOption {
  value: string;
  label: string;
  icon?: () => JSX.Element;
}

/**
 * Interface describing props shape.
 */
interface Props {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  class?: string;
  triggerClass?: string;
  menuClass?: string;
}

/**
 * Utility function to custom select.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for CustomSelect.
 * @returns Return value from CustomSelect.
 *
 * @example
 * ```typescript
 * const output = CustomSelect(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function CustomSelect(props: Props) {
  const [open, setOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;
  const selected = () => props.options.find(o => o.value === props.value);

  /**
   * Utility function to handle click outside.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param e - Input value for handleClickOutside.
   * @returns Return value from handleClickOutside.
   *
   * @example
   * ```typescript
   * const output = handleClickOutside(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function handleClickOutside(e: MouseEvent) {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false);
    }
  }

  onMount(() => document.addEventListener("mousedown", handleClickOutside));
  onCleanup(() => document.removeEventListener("mousedown", handleClickOutside));

  return (
    <div ref={containerRef} class={"relative " + (props.class || "")}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open())}
        class={
          "workflow-input w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-neutral-300 hover:border-neutral-600/80 focus:outline-none focus:border-neutral-500/90 focus:ring-1 focus:ring-neutral-500/25 transition-colors cursor-pointer " +
          (props.triggerClass || "")
        }
      >
        <Show when={selected()?.icon}>
          <span class="shrink-0 w-4 h-4 flex items-center justify-center text-neutral-400">
            {selected()!.icon!()}
          </span>
        </Show>
        <span class="flex-1 text-left truncate">{selected()?.label || props.placeholder || "Select..."}</span>
        <svg class={"shrink-0 w-3.5 h-3.5 text-neutral-500 transition-transform " + (open() ? "rotate-180" : "")} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          class={
            "absolute z-50 mt-1 w-full min-w-[160px] rounded-lg bg-neutral-900 border border-neutral-700/70 shadow-xl shadow-black/40 py-1 block-enter overflow-hidden " +
            (props.menuClass || "")
          }
        >
          <For each={props.options}>
            {(opt) => (
              <button
                type="button"
                onClick={() => { props.onChange(opt.value); setOpen(false); }}
                class={
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors cursor-pointer " +
                  (opt.value === props.value
                    ? "bg-neutral-700/45 text-neutral-100"
                    : "text-neutral-300 hover:bg-neutral-800/80 hover:text-neutral-100")
                }
              >
                <Show when={opt.icon}>
                  <span class="shrink-0 w-4 h-4 flex items-center justify-center">
                    {opt.icon!()}
                  </span>
                </Show>
                <span class="truncate">{opt.label}</span>
                <Show when={opt.value === props.value}>
                  <svg class="ml-auto shrink-0 w-3.5 h-3.5 text-neutral-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
