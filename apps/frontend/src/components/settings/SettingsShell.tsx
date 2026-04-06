import { For, Show, type JSX } from "solid-js";
import { settingsCls, type SettingsSection, type PageNoticeAccessor } from "./types";
import { useMobileMenu } from "../../context/mobile-menu.context";
const sections: Array<{ key: SettingsSection; label: string; subtitle: string }> = [
  { key: "account", label: "User Management", subtitle: "Profile, email, and password" },
  { key: "connections", label: "Connections", subtitle: "Providers and default model" },
  { key: "webhooks", label: "Webhooks & Secrets", subtitle: "Callbacks and keys" },
];

/**
 * Utility function to settings shell.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from SettingsShell.
 *
 * @example
 * ```typescript
 * const output = SettingsShell();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SettingsShell(props: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  notice: PageNoticeAccessor;
  children: JSX.Element;
}) {
  const mobileMenu = useMobileMenu();

  return (
    <main class="flex-1 flex flex-col h-full bg-[#0a0a0a] min-w-0">
      {/* Header */}
      <header class="px-6 md:px-6 py-4 border-b border-neutral-800/40 shrink-0">
        <div class={`${settingsCls.pageContainer} flex items-center gap-3`}>
          <button onClick={() => mobileMenu.toggle()} class="md:hidden p-2 text-neutral-300 hover:text-white rounded-xl bg-[#1e1e1e] border border-neutral-700/60 shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:border-neutral-500/70 hover:bg-[#242424] transition-all duration-200 block">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          <div>
            <h1 class="text-[16px] md:text-[18px] font-semibold text-neutral-100 tracking-tight">Settings</h1>
            <p class="hidden sm:block text-[12px] md:text-[13px] text-neutral-500 mt-0.5">Configure your integrations, account, and secure callbacks.</p>
          </div>
        </div>
      </header>

      {/* Body */}
      <div class="flex-1 overflow-y-auto px-0 md:px-6 py-3 md:py-6">
        <div class={`${settingsCls.pageContainer} space-y-5 md:space-y-0`}>
          <Show when={props.notice()}>
            {(notice) => (
              <div
                class={`rounded-xl border px-4 py-2.5 text-sm mb-5 ${
                  notice().tone === "success"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/25 bg-red-500/10 text-red-300"
                }`}
              >
                {notice().message}
              </div>
            )}
          </Show>

          {/* Mobile tab pills */}
          <div class="md:hidden px-4">
            <div class="overflow-x-auto scrollbar-hide -mx-1 px-1">
              <div class="inline-flex items-center rounded-xl border border-neutral-800/70 bg-neutral-950/60 p-1 gap-1 whitespace-nowrap">
              <For each={sections}>
                {(item) => (
                  <button
                    onClick={() => props.onSectionChange(item.key)}
                    class={`px-3.5 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-all duration-200 ${
                      props.activeSection === item.key
                        ? "bg-neutral-100 text-neutral-950 border-neutral-100"
                        : "bg-transparent text-neutral-400 border-transparent hover:text-neutral-200 hover:bg-neutral-900/70"
                    }`}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </div>
            </div>
          </div>

          <div class={settingsCls.contentGrid}>
            {/* Desktop sidebar nav */}
            <aside class="hidden md:block sticky top-6 -mt-2">
              <nav class="flex flex-col gap-1 rounded-2xl border border-neutral-800/60 bg-transparent p-2">
                <For each={sections}>
                  {(item) => (
                    <button
                      onClick={() => props.onSectionChange(item.key)}
                      class={`w-full text-left rounded-xl px-3.5 py-3 transition-all duration-200 group ${
                        props.activeSection === item.key
                          ? "bg-white/[0.06] text-neutral-100"
                          : "text-neutral-400 hover:bg-white/[0.03] hover:text-neutral-200"
                      }`}
                    >
                      <p class={`text-[14px] font-medium tracking-tight ${
                        props.activeSection === item.key ? "text-neutral-100" : "text-neutral-300 group-hover:text-neutral-200"
                      }`}>
                        {item.label}
                      </p>
                      <p class={`text-[12px] mt-0.5 ${
                        props.activeSection === item.key ? "text-neutral-500" : "text-neutral-600"
                      }`}>{item.subtitle}</p>
                    </button>
                  )}
                </For>
              </nav>
            </aside>

            <section class="min-w-0 settings-section-enter">{props.children}</section>
          </div>
        </div>
      </div>
    </main>
  );
}
