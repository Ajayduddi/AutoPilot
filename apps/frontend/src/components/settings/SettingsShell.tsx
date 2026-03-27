import { For, Show, type JSX } from "solid-js";
import { settingsCls, type SettingsSection, type PageNoticeAccessor } from "./types";

const sections: Array<{ key: SettingsSection; label: string; subtitle: string }> = [
  { key: "account", label: "User Management", subtitle: "Profile, email, and password" },
  { key: "connections", label: "Connections", subtitle: "Providers and default model" },
  { key: "webhooks", label: "Webhooks & Secrets", subtitle: "Callbacks and keys" },
];

export function SettingsShell(props: {
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  notice: PageNoticeAccessor;
  children: JSX.Element;
}) {
  return (
    <main class="flex-1 flex flex-col h-full bg-[#111111] min-w-0">
      <header class="px-6 py-4 border-b border-neutral-800/20 shrink-0">
        <div class={settingsCls.pageContainer}>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Configure your integrations, account, and secure callbacks.</p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto px-6 py-6">
        <div class={`${settingsCls.pageContainer} space-y-5`}>
          <Show when={props.notice()}>
            {(notice) => (
              <div
                class={`rounded-xl border px-4 py-2.5 text-sm ${
                  notice().tone === "success"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-red-500/25 bg-red-500/10 text-red-300"
                }`}
              >
                {notice().message}
              </div>
            )}
          </Show>

          <div class="md:hidden">
            <div class="inline-flex items-center rounded-xl border border-neutral-800/70 bg-neutral-950/60 p-1 gap-1 overflow-x-auto">
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

          <div class={settingsCls.contentGrid}>
            <aside class="hidden md:block sticky top-6">
              <div class="rounded-xl border border-neutral-800/70 bg-neutral-950/55 p-2">
                <For each={sections}>
                  {(item) => (
                    <button
                      onClick={() => props.onSectionChange(item.key)}
                      class={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                        props.activeSection === item.key
                          ? "bg-neutral-100/10 border border-neutral-700/70"
                          : "border border-transparent hover:bg-neutral-900/70"
                      }`}
                    >
                      <p class={`text-sm font-medium ${props.activeSection === item.key ? "text-neutral-100" : "text-neutral-300"}`}>
                        {item.label}
                      </p>
                      <p class="text-[11px] text-neutral-500 mt-0.5">{item.subtitle}</p>
                    </button>
                  )}
                </For>
              </div>
            </aside>

            <section class="min-w-0">{props.children}</section>
          </div>
        </div>
      </div>
    </main>
  );
}
