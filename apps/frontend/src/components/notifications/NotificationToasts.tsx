import { For, Show } from "solid-js";
import { useNotifications } from "../../context/notifications.context";

const toastStyles = {
  workflow_event: {
    label: "Workflow",
    shell: "border-blue-500/25 bg-[#121826]/95",
    chip: "text-blue-300 bg-blue-500/10 border-blue-500/20",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="text-blue-300">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  approval_request: {
    label: "Approval",
    shell: "border-amber-500/25 bg-[#1a1510]/95",
    chip: "text-amber-300 bg-amber-500/10 border-amber-500/20",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="text-amber-300">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  system: {
    label: "System",
    shell: "border-neutral-700/80 bg-[#151515]/95",
    chip: "text-neutral-300 bg-neutral-800/70 border-neutral-700/70",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-300">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
} as const;

export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications();

  return (
    <div class="pointer-events-none fixed top-4 right-4 z-[70] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-3">
      <For each={toasts()}>
        {(toast) => {
          const style = toastStyles[toast.type];
          return (
            <section class={`pointer-events-auto toast-enter rounded-2xl border shadow-[0_22px_55px_rgba(0,0,0,0.38)] backdrop-blur-md ${style.shell}`}>
              <div class="p-4">
                <div class="flex items-start gap-3">
                  <div class={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${style.chip}`}>
                    {style.icon}
                  </div>

                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2 pr-6">
                      <span class={`text-[10px] font-semibold uppercase tracking-[0.16em] px-2 py-1 rounded-full border ${style.chip}`}>
                        {style.label}
                      </span>
                      <Show when={toast.runId}>
                        <span class="truncate text-[10px] font-mono text-neutral-400 bg-neutral-950/70 border border-neutral-800/70 px-2 py-1 rounded-full">
                          {toast.runId}
                        </span>
                      </Show>
                    </div>

                    <h4 class="mt-3 text-sm font-semibold text-white leading-snug">
                      {toast.title}
                    </h4>
                    <Show when={toast.message}>
                      <p class="mt-1.5 text-sm text-neutral-300 leading-relaxed line-clamp-2">
                        {toast.message}
                      </p>
                    </Show>
                  </div>

                  <button
                    onClick={() => dismissToast(toast.id)}
                    class="mt-0.5 shrink-0 rounded-lg p-1.5 text-neutral-500 hover:text-white hover:bg-white/5 transition-colors"
                    aria-label="Close notification"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              </div>
            </section>
          );
        }}
      </For>
    </div>
  );
}
