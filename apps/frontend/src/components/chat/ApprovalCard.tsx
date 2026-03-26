import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface ApprovalCardProps {
  id: string;
  summary: string;
  workflowName: string;
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
  const risk = () => riskConfig[props.riskLevel || "medium"];

  return (
    <div class="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 flex flex-col gap-3 w-full max-w-lg">
      {/* Header */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-amber-400">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <span class="text-xs font-semibold uppercase tracking-widest">Approval Required</span>
        </div>
        <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${risk().class}`}>
          {risk().label}
        </span>
      </div>

      {/* Summary */}
      <p class="text-sm text-neutral-200 leading-relaxed">{props.summary}</p>
      
      {/* Workflow origin */}
      <p class="text-xs text-neutral-500">
        <span class="text-neutral-600">from</span>{" "}
        <span class="text-neutral-400 font-medium">{props.workflowName}</span>
      </p>

      {/* Divider */}
      <div class="border-t border-amber-500/10" />

      {/* Actions */}
      <div class="flex gap-2">
        <button
          onClick={props.onApprove}
          class="flex-1 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
        >
          Approve
        </button>
        <button
          onClick={props.onReject}
          class="flex-1 py-1.5 text-xs font-semibold bg-red-600/80 hover:bg-red-600 text-white rounded-lg transition-colors"
        >
          Reject
        </button>
        <button
          onClick={props.onViewDetails}
          class="px-3 py-1.5 text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
        >
          Details
        </button>
      </div>
    </div>
  );
}
