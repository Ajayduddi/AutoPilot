import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Show } from "solid-js";

/**
 * Interface describing task card props shape.
 */
interface TaskCardProps {
  title: string;
  dueDate?: string;
  status: string;
  source: string;
  description?: string;
  onViewDetails?: () => void;
  onOpenPanel?: () => void;
}
const statusColor = (s: string) => {
  if (s === "Pending") return "text-amber-400 bg-amber-500/10 border-amber-500/20";
  if (s === "Complete") return "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
  return "text-neutral-400 bg-neutral-800 border-neutral-700";
};

/**
 * Utility function to task card.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param props - Input value for TaskCard.
 * @returns Return value from TaskCard.
 *
 * @example
 * ```typescript
 * const output = TaskCard(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function TaskCard(props: TaskCardProps) {
  return (
    <Card class="w-full max-w-lg border-neutral-800/70 hover:border-blue-500/35 hover:shadow-lg hover:shadow-black/30 transition-all duration-200">
      <div
        class="flex flex-col gap-3.5 cursor-pointer"
        onClick={() => props.onOpenPanel?.()}
      >
        {/* Header row */}
        <div class="flex justify-between items-start gap-3">
          <div class="flex items-start gap-2.5">
            <div class="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
            <div>
              <h4 class="text-[15px] font-semibold text-neutral-100 leading-snug">{props.title}</h4>
              <Show when={props.description}>
                <p class="text-xs text-neutral-400 mt-1 leading-relaxed">{props.description}</p>
              </Show>
            </div>
          </div>
          <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${statusColor(props.status)}`}>
            {props.status}
          </span>
        </div>

        {/* Meta row */}
        <div class="text-xs text-neutral-500 flex items-center gap-4 pl-4">
          <Show when={props.dueDate}>
            <span class="flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
              {props.dueDate}
            </span>
          </Show>
          <span class="flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
            {props.source}
          </span>
        </div>

        {/* Actions */}
        <div class="flex gap-2 pl-4 pt-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="secondary" size="sm">Mark Complete</Button>
          <Button variant="ghost" size="sm">Edit</Button>
          <Show when={props.onViewDetails}>
            <Button variant="ghost" size="sm" onClick={props.onViewDetails}>Details →</Button>
          </Show>
        </div>
      </div>
    </Card>
  );
}
