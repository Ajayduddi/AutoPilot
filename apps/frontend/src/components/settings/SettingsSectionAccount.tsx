/**
 * @fileoverview apps/frontend/src/components/settings/SettingsSectionAccount.tsx
 *
 * High-level purpose:
 * Reusable frontend presentation module for rendering chat, settings, and UI primitives across routes.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable UI logic behind typed component contracts.
 * - Supports composable view patterns with minimal route coupling.
 * - Balances readability and flexibility for evolving product surfaces.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import the component into route or parent composition layers.
 * 2. Pass required typed props and wire callbacks to domain actions.
 * 3. Confirm visual and interaction behavior with component tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { For, Show, createEffect, createSignal, type Accessor } from "solid-js";
import * as QRCode from "qrcode";
import type { AccountInfo, MfaStatus, RuntimePreferences, TotpSetup } from "../../lib/api";
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
  mfaStatus: Accessor<MfaStatus | undefined>;
  mfaSetup: Accessor<TotpSetup | null>;
  mfaCode: Accessor<string>;
  setMfaCode: (value: string) => void;
  mfaDisableCode: Accessor<string>;
  setMfaDisableCode: (value: string) => void;
  mfaDisablePassword: Accessor<string>;
  setMfaDisablePassword: (value: string) => void;
  mfaSaving: Accessor<boolean>;
  mfaError: Accessor<string>;
  handleBeginTotpSetup: () => void;
  handleEnableTotp: () => void;
  handleDisableTotp: () => void;
  handleCopyTotpSecret: (value: string) => void;
  runtimePreferences: Accessor<RuntimePreferences | undefined>;
  runtimePreferencesLoading: Accessor<boolean>;
  approvalModeSaving: Accessor<boolean>;
  handleApprovalModeChange: (mode: "default" | "auto") => void;
}) {
  const [qrCodeUrl, setQrCodeUrl] = createSignal("");

  createEffect(async () => {
    const setup = props.mfaSetup();
    if (!setup?.otpauthUri) {
      setQrCodeUrl("");
      return;
    }
    try {
      const url = await QRCode.toDataURL(setup.otpauthUri, {
        width: 256,
        margin: 2,
        color: {
          dark: "#000000", // Pure black for reliable barcode camera scanning
          light: "#ffffff",
        },
      });
      setQrCodeUrl(url);
    } catch (err) {
      console.error("Failed to generate QR code", err);
    }
  });

  return (
    <section class={`${settingsCls.sectionCard} px-0 md:px-0 space-y-0 md:space-y-7`}>
      <div class="hidden md:block border-b border-neutral-800/40 pb-4">
        <h2 class="text-xl font-semibold text-neutral-100 tracking-tight">User Management</h2>
        <p class="text-[14px] text-neutral-500 mt-1">Manage your account profile and credentials.</p>
      </div>

      <Show
        when={!props.accountLoading()}
        fallback={
          <div class={`${settingsCls.subCard} px-4 py-3 text-sm text-neutral-500`}>
            Loading account settings...
          </div>
        }
      >
        <div class="flex flex-col md:space-y-6 divide-y divide-neutral-800/60 md:divide-none">
          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
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

          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
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

          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
            <div class="mb-4">
              <p class="text-[15px] font-medium text-neutral-200 tracking-tight">Multi-Factor Authentication</p>
              <p class="text-[13px] text-neutral-500 mt-0.5">Protect your account with a time-based authenticator app.</p>
            </div>
            <Show
              when={props.mfaStatus()?.enabled}
              fallback={
                <div class="space-y-4">
                  <div class="rounded-2xl border border-neutral-800/70 bg-[#171717] px-4 py-4">
                    <p class="text-sm font-medium text-neutral-200">TOTP is currently disabled</p>
                    <p class="mt-1 text-xs text-neutral-500">
                      Use an authenticator app like 1Password, Authy, Google Authenticator, or Bitwarden to add a second factor to sign-in.
                    </p>
                  </div>

                  <Show
                    when={props.mfaSetup()}
                    fallback={
                      <button
                        onClick={props.handleBeginTotpSetup}
                        disabled={props.mfaSaving()}
                        class={`${settingsCls.primaryBtn} inline-flex items-center justify-center gap-2`}
                      >
                        <span>{props.mfaSaving() ? "Preparing..." : "Set up TOTP MFA"}</span>
                      </button>
                    }
                  >
                    {(setup) => (
                      <div class="space-y-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <p class="text-sm font-medium text-emerald-300">Finish authenticator setup</p>
                        <p class="text-[13px] text-neutral-400">
                          Scan the QR code below with your authenticator app, or manually enter the secret. Then, enter the 6-digit code to enable MFA.
                        </p>
                        
                        <div class="flex flex-col sm:flex-row gap-5">
                          <Show when={qrCodeUrl()}>
                            <div class="shrink-0 p-3 bg-white rounded-xl shadow-sm self-start">
                              <img 
                                src={qrCodeUrl()} 
                                alt="TOTP Setup QR Code" 
                                class="w-32 h-32"
                              />
                            </div>
                          </Show>

                          <div class="flex-1 space-y-3 min-w-0">
                            <div class="grid gap-3 md:grid-cols-[1fr_auto]">
                              <div class="min-w-0 rounded-xl border border-neutral-800 bg-[#111111] px-3 py-3">
                                <p class="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Shared secret</p>
                                <p class="mt-2 break-all font-mono text-[13px] text-neutral-100">{setup().secret}</p>
                              </div>
                              <button
                                onClick={() => props.handleCopyTotpSecret(setup().secret)}
                                class={`${settingsCls.subtleBtn} self-stretch shrink-0`}
                              >
                                Copy secret
                              </button>
                            </div>
                            <div class="min-w-0 rounded-xl border border-neutral-800 bg-[#111111] px-3 py-3">
                              <p class="text-[11px] uppercase tracking-[0.18em] text-neutral-500">Provisioning URI</p>
                              <p class="mt-2 font-mono text-[12px] text-neutral-300 overflow-hidden text-ellipsis whitespace-nowrap">{setup().otpauthUri}</p>
                            </div>
                          </div>
                        </div>

                        <div class="grid gap-3 md:grid-cols-[1fr_auto] items-end pt-2">
                          <div class="space-y-1.5">
                            <label class="text-[12px] font-medium text-neutral-400 pl-1">Authenticator code</label>
                            <input
                              type="text"
                              inputmode="numeric"
                              maxLength={8}
                              value={props.mfaCode()}
                              onInput={(e) => props.setMfaCode(e.currentTarget.value.replace(/[^\d]/g, "").slice(0, 8))}
                              class={settingsCls.field}
                              placeholder="123456"
                            />
                          </div>
                          <button
                            onClick={props.handleEnableTotp}
                            disabled={props.mfaSaving()}
                            class={`${settingsCls.primaryBtn} inline-flex items-center justify-center gap-2`}
                          >
                            <span>{props.mfaSaving() ? "Enabling..." : "Enable MFA"}</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </Show>
                </div>
              }
            >
              <div class="space-y-4">
                <div class="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-4">
                  <p class="text-sm font-medium text-emerald-300">TOTP MFA is enabled</p>
                  <p class="mt-1 text-xs text-neutral-400">
                    Your account now requires a time-based authenticator code after password sign-in.
                  </p>
                </div>
                <div class="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
                  <div class="space-y-1.5">
                    <label class="text-[12px] font-medium text-neutral-400 pl-1">Authenticator code</label>
                    <input
                      type="text"
                      inputmode="numeric"
                      maxLength={8}
                      value={props.mfaDisableCode()}
                      onInput={(e) => props.setMfaDisableCode(e.currentTarget.value.replace(/[^\d]/g, "").slice(0, 8))}
                      class={settingsCls.field}
                      placeholder="123456"
                    />
                  </div>
                  <Show when={props.account()?.hasPassword} fallback={<div />}>
                    <div class="space-y-1.5">
                      <label class="text-[12px] font-medium text-neutral-400 pl-1">Current password</label>
                      <input
                        type="password"
                        value={props.mfaDisablePassword()}
                        onInput={(e) => props.setMfaDisablePassword(e.currentTarget.value)}
                        class={settingsCls.field}
                        placeholder="Confirm password"
                      />
                    </div>
                  </Show>
                  <button
                    onClick={props.handleDisableTotp}
                    disabled={props.mfaSaving()}
                    class={`${settingsCls.subtleBtn} inline-flex items-center justify-center gap-2`}
                  >
                    <span>{props.mfaSaving() ? "Disabling..." : "Disable MFA"}</span>
                  </button>
                </div>
              </div>
            </Show>
            <Show when={props.mfaError()}>
              <p class="text-xs text-red-400 mt-3">{props.mfaError()}</p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
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
                      ? "!border-indigo-500/30 !bg-indigo-500/10 !rounded-xl"
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
                      ? "!border-emerald-500/30 !bg-emerald-500/10 !rounded-xl"
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

          <div class={`${settingsCls.subCard} px-4 py-5 md:p-5`}>
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
                    ? "Use at least 12 characters with at least one letter and one number."
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
