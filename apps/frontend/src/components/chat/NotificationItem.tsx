import { JSX } from "solid-js";

import { Show } from "solid-js";

interface NotificationItemProps {
  title: string;
  message?: string;
  time: string;
  isRead: boolean;
  type: "workflow_event" | "approval_request" | "system";
  onClick?: () => void;
  onMarkRead?: () => void;
}

export function NotificationItem(props: NotificationItemProps) {
  const icons = {
    workflow_event: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-blue-400"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>,
    approval_request: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-400"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>,
    system: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-400"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>,
  };

  return (
    <div 
      class={`p-4 border-b border-neutral-800 hover:bg-neutral-800/50 cursor-pointer transition-colors ${!props.isRead ? 'bg-neutral-850/50' : ''}`}
      onClick={props.onClick}
    >
      <div class="flex gap-3">
        <div class="mt-1 shrink-0">
          {icons[props.type]}
        </div>
        <div class="flex-1">
          <div class="flex justify-between items-start">
            <h4 class={`text-sm ${!props.isRead ? 'font-semibold text-white' : 'font-medium text-neutral-200'}`}>
              {props.title}
            </h4>
            <span class="text-xs text-neutral-500 whitespace-nowrap ml-2">{props.time}</span>
          </div>
          <Show when={props.message}>
            <p class="text-sm text-neutral-400 mt-1 line-clamp-2">{props.message}</p>
          </Show>
        </div>
      </div>
    </div>
  );
}
