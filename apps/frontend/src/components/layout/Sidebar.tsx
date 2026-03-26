import { A } from "@solidjs/router";
import { createSignal, Show } from "solid-js";

export function Sidebar() {
  const [expanded, setExpanded] = createSignal(false);

  const labelClass = () => `text-[14px] whitespace-nowrap transition-[opacity,max-width] duration-300 overflow-hidden ${expanded() ? "opacity-100 max-w-[140px]" : "opacity-0 max-w-0"}`;

  return (
    <aside
      class={`border-r border-neutral-800/20 bg-[#0a0a0a] flex flex-col shrink-0 overflow-hidden`}
      style={{ width: expanded() ? "180px" : "52px", transition: "width 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}
    >
      {/* Brand */}
      <div class={`py-4 flex items-center ${expanded() ? "px-4 gap-3" : "justify-center"}`} style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <div class="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/15 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path></svg>
        </div>
        <span class={`text-[14px] font-semibold text-neutral-100 tracking-tight ${labelClass()}`}>AutoPilot</span>
      </div>

      {/* Nav */}
      <nav class={`flex-1 flex flex-col gap-1 pt-2 ${expanded() ? "px-2.5" : "items-center"}`} style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <A href="/" end class={`flex items-center rounded-xl text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2.5" : "w-9 h-9 justify-center"}`} activeClass="!bg-white/[0.08] !text-neutral-100" title="Chat">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span class={labelClass()}>Chat</span>
        </A>

        <A href="/workflows" class={`flex items-center rounded-xl text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2.5" : "w-9 h-9 justify-center"}`} activeClass="!bg-white/[0.08] !text-neutral-100" title="Workflows">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span class={labelClass()}>Workflows</span>
        </A>

        <A href="/notifications" class={`flex items-center rounded-xl text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2.5" : "w-9 h-9 justify-center"}`} activeClass="!bg-white/[0.08] !text-neutral-100" title="Notifications">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          <span class={labelClass()}>Notifications</span>
        </A>

        <A href="/approvals" class={`relative flex items-center rounded-xl text-neutral-500 hover:text-neutral-200 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2.5" : "w-9 h-9 justify-center"}`} activeClass="!bg-white/[0.08] !text-neutral-100" title="Approvals">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          <span class={`${labelClass()} flex-1`}>Approvals</span>
          <span class={`transition-all duration-300 ${expanded() ? "text-[9px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded-full opacity-100" : "absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 text-[8px] font-bold text-black rounded-full flex items-center justify-center opacity-100"}`}>2</span>
        </A>
      </nav>

      {/* Footer */}
      <div class={`pb-3 pt-2 flex flex-col gap-1 ${expanded() ? "px-2.5" : "items-center"}`} style={{ transition: "padding 400ms cubic-bezier(0.4, 0, 0.2, 1)" }}>
        <A href="/settings" class={`flex items-center rounded-xl text-neutral-600 hover:text-neutral-300 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2.5" : "w-9 h-9 justify-center"}`} activeClass="!bg-white/[0.08] !text-neutral-200" title="Settings">
          <svg class="shrink-0" xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          <span class={labelClass()}>Settings</span>
        </A>

        {/* Toggle button */}
        <button
          onClick={() => setExpanded(!expanded())}
          class={`flex items-center rounded-xl text-neutral-600 hover:text-neutral-300 hover:bg-white/5 transition-all duration-200 ${expanded() ? "gap-3 px-3 py-2" : "w-9 h-9 justify-center"}`}
          title={expanded() ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg class="shrink-0" style={{ transform: expanded() ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 400ms cubic-bezier(0.4, 0, 0.2, 1)" }} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          <span class={`text-[13px] ${labelClass()}`}>Collapse</span>
        </button>
      </div>
    </aside>
  );
}
