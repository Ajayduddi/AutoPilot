import { For, Show, type Accessor } from "solid-js";
import type { AccountInfo } from "../../lib/api";
import { settingsCls } from "./types";

export function SettingsSectionAccount(props: {
  account: Accessor<AccountInfo | undefined>;
  accountLoading: Accessor<boolean>;
  profileName: Accessor<string>;
  setProfileName: (value: string) => void;
  profileError: Accessor<string>;
  setProfileError: (value: string) => void;
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
}) {
  return (
    <section class={`${settingsCls.sectionCard} p-5 md:p-6 space-y-4`}>
      <div>
        <h2 class="text-sm font-semibold text-neutral-100">User Management</h2>
        <p class="text-xs text-neutral-500 mt-1">Manage your account profile and credentials.</p>
      </div>

      <Show
        when={!props.accountLoading()}
        fallback={
          <div class={`${settingsCls.subCard} px-4 py-3 text-sm text-neutral-500`}>
            Loading account settings...
          </div>
        }
      >
        <div class="space-y-3">
          <div class={`${settingsCls.subCard} p-4`}>
            <p class="text-xs font-semibold text-neutral-200 mb-3">Profile</p>
            <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
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
              <button
                onClick={props.handleSaveProfile}
                disabled={!props.canSaveProfile()}
                class={settingsCls.primaryBtn}
              >
                {props.profileSaving() ? "Saving..." : props.profileDirty() ? "Save changes" : "Saved"}
              </button>
            </div>
            <Show when={!props.profileError()}>
              <p class="text-xs text-neutral-500 mt-2">
                {props.profileDirty() ? "Unsaved profile changes." : "Profile is up to date."}
              </p>
            </Show>
            <Show when={props.profileError()}>
              <p class="text-xs text-red-400 mt-2">{props.profileError()}</p>
            </Show>
          </div>

          <div class={`${settingsCls.subCard} p-4`}>
            <p class="text-xs font-semibold text-neutral-200 mb-3">Email</p>
            <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
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
              <input
                type="password"
                value={props.emailCurrentPassword()}
                onInput={(e) => {
                  props.setEmailCurrentPassword(e.currentTarget.value);
                  if (props.emailError()) props.setEmailError("");
                }}
                class={settingsCls.field}
                placeholder="Current password"
              />
              <button
                onClick={props.handleSaveEmail}
                disabled={!props.canSaveEmail()}
                class={settingsCls.primaryBtn}
              >
                {props.emailSaving() ? "Saving..." : props.emailDirty() ? "Save changes" : "Saved"}
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

          <div class={`${settingsCls.subCard} p-4`}>
            <p class="text-xs font-semibold text-neutral-200 mb-3">Password</p>
            <Show
              when={props.account()?.hasPassword}
              fallback={<p class="text-sm text-neutral-400">Password login is disabled for this Google account.</p>}
            >
              <div class="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <For
                  each={[
                    { key: "current", placeholder: "Current password" },
                    { key: "next", placeholder: "New password" },
                    { key: "confirm", placeholder: "Confirm new password" },
                  ]}
                >
                  {(field) => (
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
                  )}
                </For>
                <button
                  onClick={props.handleSavePassword}
                  disabled={!props.canSavePassword()}
                  class={settingsCls.primaryBtn}
                >
                  {props.passwordSaving() ? "Saving..." : props.passwordHasInput() ? "Save changes" : "Saved"}
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
