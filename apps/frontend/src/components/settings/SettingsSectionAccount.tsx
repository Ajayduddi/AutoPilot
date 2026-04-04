import { For, Show, type Accessor } from "solid-js";
import type { AccountInfo, RuntimePreferences } from "../../lib/api";
import { settingsCls } from "./types";

/**
 * Utility function to settings section account.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @returns Return value from SettingsSectionAccount.
 *
 * @example
 * ```typescript
 * const output = SettingsSectionAccount();
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function SettingsSectionAccount(props: {
  account: Accessor<AccountInfo | undefined>;
  accountLoading: Accessor<boolean>;
  profileName: Accessor<string>;
  setProfileName: (value: string) => void;
  profileError: Accessor<string>;
  setProfileError: (value: string) => void;
  profileTimezone: Accessor<string>;
  setProfileTimezone: (value: string) => void;
  profileSaving: Accessor<boolean>;
  canSaveProfile: Accessor<boolean>;
  profileDirty: Accessor<boolean>;
  handleSaveProfile: () => void;
  emailValue: Accessor<string>;
  setEmailValue: (value: string) => void;
  emailCurrentPassword: Accessor<string>;
  setEmailCurrentPassword: (value: string) => void;
  emailError: Accessor<string>;
  setEmailError: (value: string) => void;
  emailSaving: Accessor<boolean>;
  canSaveEmail: Accessor<boolean>;
  emailDirty: Accessor<boolean>;
  handleSaveEmail: () => void;
  passwordCurrent: Accessor<string>;
  setPasswordCurrent: (value: string) => void;
  passwordNext: Accessor<string>;
  setPasswordNext: (value: string) => void;
  passwordConfirm: Accessor<string>;
  setPasswordConfirm: (value: string) => void;
  passwordError: Accessor<string>;
  setPasswordError: (value: string) => void;
  passwordSaving: Accessor<boolean>;
  passwordHasInput: Accessor<boolean>;
  canSavePassword: Accessor<boolean>;
  handleSavePassword: () => void;
  runtimePreferences: Accessor<RuntimePreferences | undefined>;
  runtimePreferencesLoading: Accessor<boolean>;
  approvalModeSaving: Accessor<boolean>;
  handleApprovalModeChange: (mode: "default" | "auto") => void;
}) {
  return (
    <section class={`${settingsCls.sectionCard} p-5 md:p-8 space-y-5 md:space-y-7`}>
      <div class="border-b border-neutral-800/40 pb-4">
        <h2 class="text-lg md:text-xl font-semibold text-neutral-100 tracking-tight">User Management</h2>
        <p class="text-[13px] md:text-[14px] text-neutral-500 mt-1">Manage your account profile and credentials.</p>
      </div>

      <Show
        when={!props.accountLoading()}
        fallback={
          <div class={`${settingsCls.subCard} px-4 py-3 text-sm text-neutral-500`}>
            Loading account settings...
          </div>
        }
      >
        <div class="space-y-5 md:space-y-6">
          <div class={`${settingsCls.subCard} p-4 md:p-5`}>
            <div class="mb-4">
              <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Profile</p>
              <p class="text-[13px] text-neutral-500 mt-0.5">Update your username and timezone preferences.</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end">
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">Username</label>
              <input
                type="text"
                value={props.profileName()}
                onInput={(e) => {
                  props.setProfileName(e.currentTarget.value);
                  if (props.profileError()) props.setProfileError("");
                }}
                class={settingsCls.field}
                placeholder="Username"
              />
              </div>
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">Timezone</label>
                <input
                  type="text"
                  value={props.profileTimezone()}
                  onInput={(e) => {
                    props.setProfileTimezone(e.currentTarget.value);
                    if (props.profileError()) props.setProfileError("");
                  }}
                  class={settingsCls.field}
                  placeholder="e.g. Asia/Kolkata"
                />
              </div>
              <button
                onClick={props.handleSaveProfile}
                disabled={!props.canSaveProfile()}
                class={`${settingsCls.primaryBtn} flex items-center justify-center gap-2`}
              >
                <Show when={props.profileSaving()} fallback={
                  <><svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>{props.profileDirty() ? "Save changes" : "Saved"}</span></>
                }>
                  <div class="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin shrink-0" />
                  <span>Saving...</span>
                </Show>
              </button>
            </div>
            <Show when={!props.profileError()}>
              <p class="text-xs text-neutral-500 mt-2">
                {props.profileDirty() ? "Unsaved profile/timezone changes." : "Profile and timezone are up to date."}
              </p>
            </Show>
            <Show when={props.profileError()}>
              <p class="text-xs text-red-400 mt-2">{props.profileError()}</p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} p-4 md:p-5`}>
            <div class="mb-4">
              <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Email</p>
              <p class="text-[13px] text-neutral-500 mt-0.5">Change your account's primary email address.</p>
            </div>
            <div class="grid gap-4 sm:grid-cols-[1fr_1fr_auto] items-end">
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">Email address</label>
              <input
                type="email"
                value={props.emailValue()}
                onInput={(e) => {
                  props.setEmailValue(e.currentTarget.value);
                  if (props.emailError()) props.setEmailError("");
                }}
                class={settingsCls.field}
                placeholder="Email"
              />
              </div>
              <div class="space-y-1.5">
                <label class="text-[12px] font-medium text-neutral-400 pl-1">Current password (required)</label>
                <input
                type="password"
                value={props.emailCurrentPassword()}
                onInput={(e) => {
                  props.setEmailCurrentPassword(e.currentTarget.value);
                  if (props.emailError()) props.setEmailError("");
                }}
                class={settingsCls.field}
                  placeholder="Confirm password"
                />
              </div>
              <button
                onClick={props.handleSaveEmail}
                disabled={!props.canSaveEmail()}
                class={`${settingsCls.primaryBtn} flex items-center justify-center gap-2`}
              >
                <Show when={props.emailSaving()} fallback={
                  <><svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>{props.emailDirty() ? "Save changes" : "Saved"}</span></>
                }>
                  <div class="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin shrink-0" />
                  <span>Saving...</span>
                </Show>
              </button>
            </div>
            <Show when={!props.emailError()}>
              <p class="text-xs text-neutral-500 mt-2">
                {props.emailDirty() ? "Enter current password to confirm email change." : "Email is up to date."}
              </p>
            </Show>
            <Show when={props.emailError()}>
              <p class="text-xs text-red-400 mt-2">{props.emailError()}</p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} p-4 md:p-5`}>
            <div class="mb-4">
              <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Agent Approval Mode</p>
              <p class="text-[13px] text-neutral-500 mt-0.5">Control how the agent executes workflows and sensitive actions.</p>
            </div>
            <Show
              when={!props.runtimePreferencesLoading()}
              fallback={<p class="text-sm text-neutral-400">Loading agent runtime preferences...</p>}
            >
              <div class="grid gap-3 md:grid-cols-2">
                <button
                  onClick={() => props.handleApprovalModeChange("default")}
                  disabled={props.approvalModeSaving()}
                  class={`${settingsCls.rowCard} p-4 text-left transition-colors ${
                    props.runtimePreferences()?.approvalMode === "default"
                      ? "border-indigo-400/50 bg-indigo-500/10"
                      : "hover:border-neutral-600"
                  }`}
                >
                  <div class="flex items-center gap-2.5 mb-1.5">
                    <div class={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      props.runtimePreferences()?.approvalMode === "default"
                        ? "bg-indigo-500/20 text-indigo-400"
                        : "bg-neutral-800/60 text-neutral-500"
                    }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
                    </div>
                    <p class="text-sm font-semibold text-neutral-100">Default Approval</p>
                  </div>
                  <p class="text-xs text-neutral-400 ml-[42px]">
                    Ask the user with a dynamic approval card before sensitive workflow actions.
                  </p>
                </button>
                <button
                  onClick={() => props.handleApprovalModeChange("auto")}
                  disabled={props.approvalModeSaving()}
                  class={`${settingsCls.rowCard} p-4 text-left transition-colors ${
                    props.runtimePreferences()?.approvalMode === "auto"
                      ? "border-emerald-400/50 bg-emerald-500/10"
                      : "hover:border-neutral-600"
                  }`}
                >
                  <div class="flex items-center gap-2.5 mb-1.5">
                    <div class={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      props.runtimePreferences()?.approvalMode === "auto"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-neutral-800/60 text-neutral-500"
                    }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                    </div>
                    <p class="text-sm font-semibold text-neutral-100">Auto Approval</p>
                  </div>
                  <p class="text-xs text-neutral-400 ml-[42px]">
                    Let the agent execute actions directly and report back what it did.
                  </p>
                </button>
              </div>
              <p class="text-xs text-neutral-500 mt-3">
                {props.approvalModeSaving()
                  ? "Updating approval policy..."
                  : props.runtimePreferences()?.approvalMode === "auto"
                    ? "Auto approval is active for the main agent runtime."
                    : "Default approval is active for the main agent runtime."}
              </p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} p-4 md:p-5`}>
            <div class="mb-4">
              <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Password</p>
              <p class="text-[13px] text-neutral-500 mt-0.5">Update your secure login password.</p>
            </div>
            <Show
              when={props.account()?.hasPassword}
              fallback={<p class="text-sm text-neutral-400">Password login is disabled for this Google account.</p>}
            >
              <div class="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] items-end">
                <For
                  each={[
                    { key: "current", placeholder: "Current password" },
                    { key: "next", placeholder: "New password" },
                    { key: "confirm", placeholder: "Confirm new password" },
                  ]}
                >
                  {(field) => (
                    <div class="space-y-1.5">
                      <label class="text-[12px] font-medium text-neutral-400 pl-1">{field.placeholder}</label>
                      <input
                        type="password"
                        value={
                          field.key === "current"
                            ? props.passwordCurrent()
                            : field.key === "next"
                              ? props.passwordNext()
                              : props.passwordConfirm()
                        }
                        onInput={(e) => {
                          const value = e.currentTarget.value;
                          if (field.key === "current") props.setPasswordCurrent(value);
                          else if (field.key === "next") props.setPasswordNext(value);
                          else props.setPasswordConfirm(value);
                          if (props.passwordError()) props.setPasswordError("");
                        }}
                        class={settingsCls.field}
                        placeholder={field.placeholder}
                      />
                    </div>
                  )}
                </For>
                <button
                  onClick={props.handleSavePassword}
                  disabled={!props.canSavePassword()}
                  class={`${settingsCls.primaryBtn} flex items-center justify-center gap-2`}
                >
                  <Show when={props.passwordSaving()} fallback={
                    <><svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> <span>{props.passwordHasInput() ? "Save changes" : "Saved"}</span></>
                  }>
                    <div class="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin shrink-0" />
                    <span>Saving...</span>
                  </Show>
                </button>
              </div>
              <Show when={!props.passwordError()}>
                <p class="text-xs text-neutral-500 mt-2">
                  {props.passwordHasInput()
                    ? "Use at least 8 characters for the new password."
                    : "No password changes pending."}
                </p>
              </Show>
              <Show when={props.passwordError()}>
                <p class="text-xs text-red-400 mt-2">{props.passwordError()}</p>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
