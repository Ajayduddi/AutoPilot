import { For, Show, createSignal } from "solid-js";

/**
 * Interface describing notification item props shape.
 */
interface NotificationItemProps {
  title: string;
  message?: string;
  timeLabel: string;
  dateLabel: string;
  isRead: boolean;
  isNew?: boolean;
  runId?: string;
  type: "workflow_event" | "approval_request" | "system";
  previewLabel?: string;
  ctaLabel?: string;
  summary?: string;
  summaryBullets?: string[];
  rawPreview?: string;
  followUpLabel?: string;
  onPreview?: () => void;
  onOpenRoute?: () => void;
  onFollowUp?: () => void;
  onMarkRead?: () => void;
}
const typeConfig = {
  workflow_event: {
    label: "Workflow",
    accent: "border-blue-500/25 bg-blue-500/[0.05]",
    chip: "text-blue-300 bg-blue-500/10 border-blue-500/20",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="text-blue-300">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  approval_request: {
    label: "Approval",
    accent: "border-amber-500/25 bg-amber-500/[0.05]",
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
    accent: "border-neutral-700/80 bg-neutral-900/55",
    chip: "text-neutral-300 bg-neutral-800/70 border-neutral-700/70",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-300">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
};

/**
 * Utility function to notification item.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for NotificationItem.
 * @returns Return value from NotificationItem.
 *
 * @example
 * ```typescript
 * const output = NotificationItem(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function NotificationItem(props: NotificationItemProps) {
  const [showRaw, setShowRaw] = createSignal(false);
  const cfg = () => typeConfig[props.type];

  return (
    <article
      onClick={props.onPreview}
      class={`rounded-2xl border shadow-[0_18px_40px_rgba(0,0,0,0.22)] transition-all duration-200 ${
        props.isRead
          ? "border-neutral-800/70 bg-neutral-900/45 hover:border-neutral-700/80 hover:bg-neutral-900/70"
          : cfg().accent
      } ${props.isNew ? "notification-arrive" : ""} ${props.onPreview ? "cursor-pointer" : ""}`}
    >
      <div class="p-4 sm:p-5">
        <div class="flex items-start gap-3">
          <div class={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${cfg().chip}`}>
            {cfg().icon}
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class={`text-[10px] font-semibold uppercase tracking-[0.16em] px-2 py-1 rounded-full border ${cfg().chip}`}>
                {cfg().label}
              </span>
              <Show when={props.runId}>
                <span class="text-[10px] font-mono text-neutral-400 bg-neutral-950/70 border border-neutral-800/70 px-2 py-1 rounded-full">
                  {props.runId}
                </span>
              </Show>
              <Show when={!props.isRead}>
                <span class="text-[10px] font-semibold uppercase tracking-[0.16em] text-white bg-white/10 px-2 py-1 rounded-full">
                  Unread
                </span>
              </Show>
            </div>

            <div class="mt-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class={`text-[15px] leading-snug ${props.isRead ? "font-medium text-neutral-100" : "font-semibold text-white"}`}>
                  {props.title}
                </h3>
                <Show when={props.message}>
                  <p class="mt-2 text-sm text-neutral-400 leading-relaxed">
                    {props.message}
                  </p>
                </Show>
              </div>

              <div class="shrink-0 text-right">
                <p class="text-xs text-neutral-300">{props.timeLabel}</p>
                <p class="mt-1 text-[11px] text-neutral-500">{props.dateLabel}</p>
              </div>
            </div>

            <Show when={props.summary || (props.summaryBullets && props.summaryBullets.length > 0)}>
              <div class="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/[0.04] px-3.5 py-3">
                <p class="text-[10px] uppercase tracking-[0.14em] text-blue-300 font-semibold">AI Summary</p>
                <Show when={props.summary}>
                  <p class="mt-2 text-sm text-neutral-200 leading-relaxed">{props.summary}</p>
                </Show>
                <Show when={props.summaryBullets && props.summaryBullets.length > 0}>
                  <ul class="mt-2 space-y-1.5 text-xs text-neutral-300 list-disc pl-4">
                    <For each={props.summaryBullets}>
                      {(point) => <li>{point}</li>}
                    </For>
                  </ul>
                </Show>
              </div>
            </Show>

            <Show when={props.rawPreview}>
              <div class="mt-3">
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    setShowRaw((v) => !v);
                  }}
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 transition-colors"
                >
                  {showRaw() ? "Hide raw result" : "View raw result"}
                </button>
                <Show when={showRaw()}>
                  <pre class="mt-2 text-xs text-neutral-300 bg-neutral-950/70 border border-neutral-800/70 rounded-xl p-3 overflow-x-auto max-h-52 whitespace-pre-wrap break-all">
                    {props.rawPreview}
                  </pre>
                </Show>
              </div>
            </Show>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <Show when={props.onPreview}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onPreview?.();
                  }}
                  class="text-xs font-medium px-3 py-1.5 rounded-lg bg-neutral-100 text-neutral-950 hover:bg-white transition-colors"
                >
                  {props.previewLabel || "Preview"}
                </button>
              </Show>
              <Show when={props.onOpenRoute}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onOpenRoute?.();
                  }}
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 transition-colors"
                >
                  {props.ctaLabel || "Open"}
                </button>
              </Show>
              <Show when={props.onFollowUp}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onFollowUp?.();
                  }}
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-500/25 text-blue-200 hover:text-blue-100 hover:border-blue-400/45 hover:bg-blue-500/10 transition-colors"
                >
                  {props.followUpLabel || "Follow up"}
                </button>
              </Show>
              <Show when={!props.isRead}>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onMarkRead?.();
                  }}
                  class="text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-700/70 text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-neutral-800/60 transition-colors"
                >
                  Mark read
                </button>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
