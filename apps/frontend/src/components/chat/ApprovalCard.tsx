import { Show, createMemo, createSignal } from "solid-js";

interface ApprovalCardProps {
  id: string;
  summary: string;
  workflowName: string;
  createdAt?: string;
  details?: unknown;
  busy?: boolean;
  riskLevel?: "low" | "medium" | "high";
  onApprove?: () => void;
  onReject?: () => void;
  onViewDetails?: () => void;
}

const riskConfig = {
  low: { label: "Low Risk", class: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  medium: { label: "Medium Risk", class: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
  high: { label: "High Risk", class: "text-red-400 bg-red-500/10 border-red-500/20" },
};

export function ApprovalCard(props: ApprovalCardProps) {
  const [showDetails, setShowDetails] = createSignal(false);
  const risk = () => riskConfig[props.riskLevel || "medium"];
  const createdAtLabel = () =>
    props.createdAt
      ? new Date(props.createdAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const detailsText = createMemo(() => {
    if (!props.details) return "";
    if (typeof props.details === "string") return props.details;
    try {
      return JSON.stringify(props.details, null, 2);
    } catch {
      return String(props.details);
    }
  });

  return (
    <div class="rounded-2xl border border-neutral-800/80 bg-neutral-950/75 shadow-[0_16px_36px_rgba(0,0,0,0.32)] p-5 flex flex-col gap-4 w-full">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex items-start gap-3">
          <div class="w-10 h-10 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">Approval Required</span>
              <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${risk().class}`}>
                {risk().label}
              </span>
            </div>
            <p class="mt-1 text-[15px] font-semibold text-neutral-100 leading-snug break-words">
              {props.summary}
            </p>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[10px] font-medium rounded-full border border-neutral-800 bg-neutral-900/80 text-neutral-300 px-2.5 py-1 font-mono">
          {props.workflowName}
        </span>
        <span class="text-[10px] font-medium rounded-full border border-neutral-800 bg-neutral-900/80 text-neutral-400 px-2.5 py-1 font-mono">
          {props.id}
        </span>
        <Show when={createdAtLabel()}>
          <span class="text-[10px] rounded-full border border-neutral-800/80 bg-neutral-900/70 text-neutral-400 px-2.5 py-1">
            {createdAtLabel()}
          </span>
        </Show>
      </div>

      <Show when={detailsText().length > 0}>
        <div class="rounded-xl border border-neutral-800/80 bg-neutral-900/45 p-3">
          <button
            onClick={() => setShowDetails((v) => !v)}
            class="text-[11px] font-medium text-neutral-300 hover:text-white transition-colors"
          >
            {showDetails() ? "Hide details" : "View details"}
          </button>
          <Show when={showDetails()}>
            <pre class="mt-2 text-[11px] leading-5 text-neutral-300 bg-black/35 border border-neutral-800 rounded-lg p-3 overflow-auto max-h-52">
              {detailsText()}
            </pre>
          </Show>
        </div>
      </Show>

      <div class="border-t border-neutral-800/70" />

      <div class="flex flex-wrap gap-2">
        <button
          onClick={props.onApprove}
          disabled={props.busy}
          class={`px-4 py-2 text-xs font-semibold rounded-lg border transition-all duration-200 ${
            props.busy
              ? "cursor-not-allowed border-emerald-500/20 bg-emerald-500/10 text-emerald-200/60"
              : "border-emerald-500/35 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 hover:border-emerald-400/45"
          }`}
        >
          {props.busy ? "Processing..." : "Approve"}
        </button>
        <button
          onClick={props.onReject}
          disabled={props.busy}
          class={`px-4 py-2 text-xs font-semibold rounded-lg border transition-all duration-200 ${
            props.busy
              ? "cursor-not-allowed border-red-500/20 bg-red-500/10 text-red-200/60"
              : "border-red-500/35 bg-red-500/15 text-red-200 hover:bg-red-500/25 hover:border-red-400/45"
          }`}
        >
          Reject
        </button>
      </div>
    </div>
  );
}
