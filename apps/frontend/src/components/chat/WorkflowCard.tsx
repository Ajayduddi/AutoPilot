import { Card } from "../ui/Card";
import { Button } from "../ui/Button";

interface WorkflowCardProps {
  name: string;
  status: "running" | "completed" | "failed" | "waiting_approval";
  runId: string;
  startedAt?: string;
  completedAt?: string;
  timeline?: string;
  onViewDetails?: () => void;
}

const statusConfig = {
  running: {
    label: "Running",
    pill: "text-blue-400 bg-blue-500/10 border-blue-500/20",
    dot: "bg-blue-500 animate-pulse",
  },
  completed: {
    label: "Completed",
    pill: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    dot: "bg-emerald-500",
  },
  failed: {
    label: "Failed",
    pill: "text-red-400 bg-red-500/10 border-red-500/20",
    dot: "bg-red-500",
  },
  waiting_approval: {
    label: "Awaiting Approval",
    pill: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    dot: "bg-amber-500 animate-pulse",
  },
};

export function WorkflowCard(props: WorkflowCardProps) {
  const cfg = () => statusConfig[props.status];

  const timeline = () => {
    if (props.timeline) return props.timeline;
    if (props.status === "running" && props.startedAt) return `Started ${props.startedAt}`;
    if (props.status === "completed" && props.completedAt) return `Completed ${props.completedAt}`;
    if (props.status === "failed") return "Execution failed, check run details";
    if (props.status === "waiting_approval") return "Waiting for approval to continue";
    return "Timeline unavailable";
  };

  return (
    <Card class="w-full max-w-lg border-neutral-800/70 hover:border-blue-500/30 hover:shadow-lg hover:shadow-black/30 transition-all duration-200">
      <div class="flex flex-col gap-3.5">
        {/* Header */}
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-center gap-2.5">
            <div class={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${cfg().dot}`} />
            <div>
              <h4 class="text-[15px] font-semibold text-neutral-100">{props.name}</h4>
              <p class="text-[11px] text-neutral-400 font-mono mt-0.5">{props.runId}</p>
            </div>
          </div>
          <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cfg().pill}`}>
            {cfg().label}
          </span>
        </div>

        {/* Progress bar for running state */}
        {props.status === "running" && (
          <div class="h-0.5 w-full bg-neutral-800 rounded-full overflow-hidden">
            <div class="h-full bg-blue-500/60 rounded-full animate-pulse w-2/3" />
          </div>
        )}

        <div class="rounded-lg bg-neutral-900/60 border border-neutral-800/70 px-3 py-2.5">
          <p class="text-[10px] uppercase tracking-[0.14em] text-neutral-400">Timeline</p>
          <p class="text-xs text-neutral-100 mt-1">{timeline()}</p>
        </div>

        {/* Actions */}
        <div class="flex gap-2">
          <Button variant="ghost" size="sm" onClick={props.onViewDetails}>
            View details →
          </Button>
          {props.status === "waiting_approval" && (
            <span class="text-xs text-amber-400 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
              Needs your approval
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
