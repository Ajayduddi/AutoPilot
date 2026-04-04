import { Show } from "solid-js";
import { Button } from "../ui/Button";

// ─── Provider badge colors ─────────────────────────────────────
const providerStyles: Record<string, { bg: string; text: string; label: string }> = {
  n8n: { bg: "bg-orange-500/12 border-orange-400/25", text: "text-orange-200", label: "n8n" },
  zapier: { bg: "bg-amber-500/12 border-amber-400/25", text: "text-amber-200", label: "Zapier" },
  make: { bg: "bg-violet-500/12 border-violet-400/25", text: "text-violet-200", label: "Make" },
  sim: { bg: "bg-cyan-500/12 border-cyan-400/25", text: "text-cyan-200", label: "Sim" },
  custom: { bg: "bg-slate-500/12 border-slate-400/25", text: "text-slate-200", label: "Custom" },
};
const statusStyles: Record<string, { dot: string; label: string }> = {
  completed: { dot: "bg-emerald-500", label: "Completed" },
  running: { dot: "bg-blue-500 animate-pulse", label: "Running" },
  failed: { dot: "bg-red-500", label: "Failed" },
  queued: { dot: "bg-neutral-500 animate-pulse", label: "Queued" },
  waiting_approval: { dot: "bg-amber-500 animate-pulse", label: "Awaiting" },
};

/**
 * Interface describing workflow list card props shape.
 */
interface WorkflowListCardProps {
  id: string;
  name: string;
  workflowKey: string;
  provider: string;
  visibility: string;
  enabled: boolean;
  archived: boolean;
  description?: string | null;
  tags?: string[];
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  triggerSource?: string;
  onTrigger: (id: string) => void;
  onViewDetails: (id: string) => void;
  isTriggering?: boolean;
  layout?: "grid" | "list";
}

/**
 * Utility function to workflow list card.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for WorkflowListCard.
 * @returns Return value from WorkflowListCard.
 *
 * @example
 * ```typescript
 * const output = WorkflowListCard(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function WorkflowListCard(props: WorkflowListCardProps) {
  const prov = () => providerStyles[props.provider] || providerStyles.custom;
  const lastStatus = () => (props.lastRunStatus ? statusStyles[props.lastRunStatus] || null : null);
  const timeAgo = () => {
    if (!props.lastRunAt) return null;
    const diff = Date.now() - new Date(props.lastRunAt).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };
  const stateOpacity = () =>
    props.archived ? "opacity-65" : !props.enabled ? "opacity-80" : "";
  const baseCls =
    "bg-gradient-to-br from-neutral-800/55 to-neutral-900/82 border border-neutral-700/40 transition-all duration-300 cursor-pointer";
  const hoverCls = () =>
    props.enabled && !props.archived
      ? "hover:border-indigo-500/25 hover:shadow-[0_16px_40px_rgba(0,0,0,0.42),0_0_0_1px_rgba(99,102,241,0.08)]"
      : "";

  // ── shared trigger button content ─────────────────────────────────────────
  const TriggerBtn = () => (
    <div onClick={(e) => e.stopPropagation()}>
      <Show when={props.enabled && !props.archived}>
        <Button
          variant="primary"
          size="sm"
          disabled={props.isTriggering}
          onClick={() => props.onTrigger(props.id)}
          class="text-[11px] px-2.5 py-1"
        >
          {props.isTriggering ? (
            <div class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6 3 20 12 6 21 6 3" />
              </svg>{" "}
              Trigger
            </>
          )}
        </Button>
      </Show>
    </div>
  );

  return (
    <Show
      when={props.layout === "list"}
      fallback={
        // ── GRID CARD ────────────────────────────────────────────────────────
        <div
          class={`group h-full flex flex-col rounded-2xl shadow-[0_8px_22px_rgba(0,0,0,0.3)] workflow-card-glow ${baseCls} ${hoverCls()} ${stateOpacity()} hover:-translate-y-[2px]`}
          onClick={() => props.onViewDetails(props.id)}
        >
          <div class="p-4 md:p-5 flex flex-col gap-3.5 flex-1">
            {/* Header row */}
            <div class="flex items-start justify-between gap-3">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1.5">
                  <h4 class="text-[15px] font-semibold text-slate-100 truncate tracking-tight">{props.name}</h4>
                  <Show when={!props.enabled && !props.archived}>
                    <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/35 shrink-0">
                      Disabled
                    </span>
                  </Show>
                  <Show when={props.archived}>
                    <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/35 shrink-0">
                      Archived
                    </span>
                  </Show>
                </div>
                <p class="text-[11px] text-slate-300/95 font-mono truncate">{props.workflowKey}</p>
              </div>
              {/* Provider badge */}
              <span class={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${prov().bg} ${prov().text}`}>
                {prov().label}
              </span>
            </div>

            {/* Description */}
            <Show when={props.description}>
              <p class="text-[13px] text-slate-200 line-clamp-2 leading-relaxed">{props.description}</p>
            </Show>

            {/* Tags */}
            <Show when={props.tags && props.tags.length > 0}>
              <div class="flex flex-wrap items-center gap-1.5">
                {(props.tags || []).slice(0, 4).map((tag) => (
                  <span class="inline-flex items-center text-[11px] font-medium px-2.5 pt-[3px] pb-[4px] rounded-full bg-neutral-700/55 text-slate-200/90 border border-neutral-600/45 tracking-wide leading-[1.1]">
                    {tag}
                  </span>
                ))}
                <Show when={(props.tags || []).length > 4}>
                  <span class="inline-flex items-center text-[11px] font-medium px-2.5 pt-[3px] pb-[4px] rounded-full bg-neutral-700/30 text-slate-400 border border-neutral-600/30 leading-[1.1]">
                    +{(props.tags || []).length - 4}
                  </span>
                </Show>
              </div>
            </Show>

            {/* Footer */}
            <div class="mt-auto pt-3.5 flex items-center justify-between border-t border-slate-700/35">
              <div class="flex items-center gap-2">
                <Show when={lastStatus()} fallback={<span class="text-[10px] text-slate-400">No runs yet</span>}>
                  <div class={`w-1.5 h-1.5 rounded-full ${lastStatus()!.dot}`} />
                  <span class="text-[11px] text-slate-200">
                    {lastStatus()!.label}
                    {timeAgo() && ` • ${timeAgo()}`}
                  </span>
                </Show>
                <Show when={props.visibility === "private"}>
                  <span class="text-[10px] text-slate-300 flex items-center gap-0.5 ml-1">
                    <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Private
                  </span>
                </Show>
              </div>
              <TriggerBtn />
            </div>
          </div>
        </div>
      }
    >
      {/* ── LIST ROW ──────────────────────────────────────────────────────── */}
      <div
        class={`group flex items-center gap-2 sm:gap-4 rounded-xl px-3 sm:px-4 py-3 shadow-[0_2px_10px_rgba(0,0,0,0.22)] ${baseCls} ${hoverCls()} ${stateOpacity()}`}
        onClick={() => props.onViewDetails(props.id)}
      >
        {/* Status dot */}
        <div class="shrink-0">
          <Show when={lastStatus()} fallback={<div class="w-2 h-2 rounded-full bg-neutral-600" />}>
            <div class={`w-2 h-2 rounded-full ${lastStatus()!.dot}`} />
          </Show>
        </div>

        {/* Name + key */}
        <div class="min-w-0 flex-1 sm:flex-none sm:w-[210px]">
          <div class="flex items-center gap-1.5">
            <span class="text-[13.5px] font-semibold text-slate-100 truncate tracking-tight">{props.name}</span>
            <Show when={!props.enabled && !props.archived}>
              <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/35 shrink-0">Off</span>
            </Show>
            <Show when={props.archived}>
              <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-700/40 text-slate-300 border border-slate-600/35 shrink-0">Archived</span>
            </Show>
          </div>
          <p class="text-[10.5px] text-slate-400 font-mono truncate">{props.workflowKey}</p>
        </div>

        {/* Description */}
        <p class="hidden md:block flex-1 min-w-0 text-[12.5px] text-slate-300/85 truncate">
          {props.description ?? <span class="text-slate-600 italic">No description</span>}
        </p>

        {/* Provider + tags */}
        <div class="hidden sm:flex items-center gap-1.5 shrink-0 ml-auto justify-end min-w-[150px]">
          <span class={`shrink-0 text-[10px] font-semibold px-2.5 py-[3px] rounded-full border ${prov().bg} ${prov().text}`}>
            {prov().label}
          </span>
          <Show when={props.tags && props.tags.length > 0}>
            <div class="flex items-center gap-1">
              {(props.tags || []).slice(0, 3).map((tag) => (
                <span class="inline-flex items-center text-[10.5px] font-medium px-2 pt-[3px] pb-[4px] rounded-full bg-neutral-700/55 text-slate-200/90 border border-neutral-600/45 leading-[1.1]">
                  {tag}
                </span>
              ))}
              <Show when={(props.tags || []).length > 3}>
                <span class="text-[10px] text-slate-500 ml-0.5">+{(props.tags || []).length - 3}</span>
              </Show>
            </div>
          </Show>
        </div>

        {/* Private icon */}
        <div class="w-4 shrink-0 flex items-center justify-center">
          <Show when={props.visibility === "private"}>
            <svg class="text-slate-500" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </Show>
        </div>

        <div class="shrink-0 w-auto sm:w-[84px] ml-auto flex justify-end">
          <TriggerBtn />
        </div>
      </div>
    </Show>
  );
}
