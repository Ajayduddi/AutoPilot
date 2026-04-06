import { Title } from "@solidjs/meta";
import { useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js";
import { authApi, type AccountInfo, type RuntimePreferences, settingsApi } from "../lib/api";
import { SettingsSectionAccount } from "../components/settings/SettingsSectionAccount";
import { SettingsSectionConnections } from "../components/settings/SettingsSectionConnections";
import { SettingsSectionWebhooks } from "../components/settings/SettingsSectionWebhooks";
import { SettingsShell } from "../components/settings/SettingsShell";
import { firstParam, mapLegacyTab, normalizeSection } from "./settings.helpers";
import {
  EMAIL_REGEX,
  /**
    * confirm state type alias.
    */
  type ConfirmState,
  /**
    * settings section type alias.
    */
  type SettingsSection,
  /**
    * webhook secret record type alias.
    */
  type WebhookSecretRecord,
  providerLabel,
} from "../components/settings/types";

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [providers, { refetch }] = createResource(() => settingsApi.getProviders());
  const [account, { refetch: refetchAccount }] = createResource<AccountInfo>(() => authApi.getAccount());
  const [webhookSecrets, { refetch: refetchWebhookSecrets }] = createResource<WebhookSecretRecord[]>(
    () => settingsApi.getWebhookSecrets(),
  );
  const [runtimePreferences, { refetch: refetchRuntimePreferences }] = createResource<RuntimePreferences>(
    () => settingsApi.getRuntimePreferences(),
  );

  const [isAdding, setIsAdding] = createSignal(false);
  const [provider, setProvider] = createSignal("ollama");
  const [customName, setCustomName] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [baseUrl, setBaseUrl] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal("");
  const [defaultModel, setDefaultModel] = createSignal("");
  const [savingDefaultModel, setSavingDefaultModel] = createSignal(false);
  const [defaultModelError, setDefaultModelError] = createSignal("");

  const [webhookLabel, setWebhookLabel] = createSignal("");
  const [isGeneratingWebhookKey, setIsGeneratingWebhookKey] = createSignal(false);
  const [webhookErrorMsg, setWebhookErrorMsg] = createSignal("");
  const [generatedWebhookSecret, setGeneratedWebhookSecret] = createSignal("");
  const [copiedWebhookSecret, setCopiedWebhookSecret] = createSignal(false);

  const [pageNotice, setPageNotice] = createSignal<{ tone: "success" | "error"; message: string } | null>(null);
  const [confirmState, setConfirmState] = createSignal<ConfirmState | null>(null);
  const [confirming, setConfirming] = createSignal(false);

  const [expandedExamples, setExpandedExamples] = createSignal({ unified: false });
  const [copiedExample, setCopiedExample] = createSignal<"" | "unified">("");
  const [copiedEndpoint, setCopiedEndpoint] = createSignal<"" | "unified">("");

  const [profileName, setProfileName] = createSignal("");
  const [profileTimezone, setProfileTimezone] = createSignal("");
  const [profileSaving, setProfileSaving] = createSignal(false);
  const [profileError, setProfileError] = createSignal("");

  const [emailValue, setEmailValue] = createSignal("");
  const [emailCurrentPassword, setEmailCurrentPassword] = createSignal("");
  const [emailSaving, setEmailSaving] = createSignal(false);
  const [emailError, setEmailError] = createSignal("");

  const [passwordCurrent, setPasswordCurrent] = createSignal("");
  const [passwordNext, setPasswordNext] = createSignal("");
  const [passwordConfirm, setPasswordConfirm] = createSignal("");
  const [passwordSaving, setPasswordSaving] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal("");
  const [approvalModeSaving, setApprovalModeSaving] = createSignal(false);
  const activeSection = createMemo<SettingsSection>(() => {
    const legacy = mapLegacyTab(firstParam(searchParams.tab));
    return normalizeSection(firstParam(searchParams.section) ?? legacy ?? undefined);
  });

  createEffect(() => {
    const legacy = mapLegacyTab(firstParam(searchParams.tab));
    const sectionParam = firstParam(searchParams.section);
    const normalized = normalizeSection(sectionParam ?? legacy ?? undefined);
    if (sectionParam !== normalized || searchParams.tab !== undefined) {
      setSearchParams({ section: normalized, tab: undefined as unknown as string }, { replace: true });
    }
  });
  const activeProviderConfig = createMemo(() => (providers() || []).find((p) => p.isDefault));
  const activeProviderName = createMemo(() => providerLabel(activeProviderConfig()?.provider || ""));

  const [activeProviderModels, { refetch: refetchActiveProviderModels }] = createResource(
    () => activeProviderConfig()?.id || null,
    async () => {
      const active = activeProviderConfig();
      if (!active) return [] as string[];
      return settingsApi.fetchModels({
        provider: active.provider,
        providerId: active.id,
        baseUrl: active.baseUrl || undefined,
        apiKey: active.apiKey || undefined,
      });
    },
  );
  const defaultModelOptions = createMemo(() =>
    [
      { value: "auto", label: "Auto (Agent picks best model/provider)" },
      ...(activeProviderModels() || []).map((modelName) => ({
        value: modelName,
        label: `${activeProviderName()}: ${modelName}`,
      })),
    ],
  );
  const defaultModelDisplayLabel = createMemo(() => {
    const value = defaultModel().trim();
    if (!value) return "Not set";
    if (value.toLowerCase() === "auto") return "Auto (Agent picks best model/provider)";
    return `${activeProviderName()}: ${value}`;
  });
  const activeWebhookSecrets = createMemo(() =>
    (webhookSecrets() || []).filter((secret) => {
      const status = (secret.status || "").toLowerCase();
      return !secret.revokedAt && status !== "revoked";
    }),
  );
  const profileDirty = createMemo(() => {
    const original = (account()?.name || "").trim();
    const originalTimezone = (account()?.timezone || "").trim();
    return profileName().trim() !== original || profileTimezone().trim() !== originalTimezone;
  });
  const canSaveProfile = createMemo(() => {
    const name = profileName().trim();
    return profileDirty() && name.length > 0 && name.length <= 80 && !profileSaving();
  });
  const emailDirty = createMemo(() => {
    const original = (account()?.email || "").trim().toLowerCase();
    return emailValue().trim().toLowerCase() !== original;
  });
  const canSaveEmail = createMemo(() => {
    const email = emailValue().trim().toLowerCase();
    return emailDirty() && EMAIL_REGEX.test(email) && emailCurrentPassword().length > 0 && !emailSaving();
  });
  const passwordHasInput = createMemo(() =>
    Boolean(passwordCurrent().trim() || passwordNext().trim() || passwordConfirm().trim()),
  );
  const passwordFormValid = createMemo(() =>
    passwordCurrent().trim().length > 0 && passwordNext().length >= 8 && passwordNext() === passwordConfirm(),
  );
  const canSavePassword = createMemo(() => passwordFormValid() && !passwordSaving());

  createEffect(() => {
    const data = account();
    if (!data) return;
    setProfileName(data.name || "");
    setProfileTimezone(data.timezone || "");
    setEmailValue(data.email || "");
  });

  /**
   * Utility function to handle approval mode change.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param mode - Input value for handleApprovalModeChange.
   * @returns Return value from handleApprovalModeChange.
   *
   * @example
   * ```typescript
   * const output = handleApprovalModeChange(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleApprovalModeChange(mode: "default" | "auto") {
    try {
      setApprovalModeSaving(true);
      await settingsApi.updateRuntimePreferences({ approvalMode: mode });
      await refetchRuntimePreferences();
      pushNotice("success", mode === "auto" ? "Agent auto-approval enabled." : "Default approval mode enabled.");
    } catch (err: any) {
      pushNotice("error", err.message || "Failed to update approval mode.");
    } finally {
      setApprovalModeSaving(false);
    }
  }

  createEffect(() => {
    const active = activeProviderConfig();
    if (!active) {
      setDefaultModel("");
      return;
    }
    const configured = (active.model || "").trim();
    if (configured && configured !== "dynamic") {
      setDefaultModel(configured);
      return;
    }
    const first = (activeProviderModels() || [])[0] || "";
    setDefaultModel(first);
  });

  /**
   * Utility function to set section.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param section - Input value for setSection.
   * @returns Return value from setSection.
   *
   * @example
   * ```typescript
   * const output = setSection(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function setSection(section: SettingsSection) {
    setSearchParams({ section, tab: undefined as unknown as string });
  }

  /**
   * Utility function to push notice.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param tone - Input value for pushNotice.
   * @param message - Input value for pushNotice.
   * @returns Return value from pushNotice.
   *
   * @example
   * ```typescript
   * const output = pushNotice(value, value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function pushNotice(tone: "success" | "error", message: string) {
    setPageNotice({ tone, message });
    window.setTimeout(() => setPageNotice(null), 2600);
  }

  /**
   * Utility function to reset form.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from resetForm.
   *
   * @example
   * ```typescript
   * const output = resetForm();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function resetForm() {
    setProvider("ollama");
    setCustomName("");
    setApiKey("");
    setBaseUrl("");
    setErrorMsg("");
  }

  /**
   * Utility function to handle save.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSave.
   *
   * @example
   * ```typescript
   * const output = handleSave();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSave() {
    try {
      setSaving(true);
      setErrorMsg("");
      await settingsApi.saveProviderConfig({
        provider: provider(),
        model: "dynamic",
        customName: customName().trim() || undefined,
        apiKey: apiKey(),
        baseUrl: baseUrl(),
      });
      setIsAdding(false);
      resetForm();
      await refetch();
      pushNotice("success", "Connection saved.");
    } catch (err: any) {
      const message = err.message || "Failed to save provider config";
      setErrorMsg(message);
      pushNotice("error", message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Utility function to handle set active.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param id - Input value for handleSetActive.
   * @returns Return value from handleSetActive.
   *
   * @example
   * ```typescript
   * const output = handleSetActive(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSetActive(id: string) {
    try {
      await settingsApi.setActiveProvider(id);
      await refetch();
      await refetchActiveProviderModels();
      pushNotice("success", "Active provider updated.");
    } catch (err: any) {
      pushNotice("error", err.message || "Error setting active provider.");
    }
  }

  /**
   * Utility function to handle save default model.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSaveDefaultModel.
   *
   * @example
   * ```typescript
   * const output = handleSaveDefaultModel();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSaveDefaultModel() {
    const active = activeProviderConfig();
    const model = defaultModel().trim();
    if (!active || !model) return;

    try {
      setSavingDefaultModel(true);
      setDefaultModelError("");
      await settingsApi.updateProviderModel(active.id, model);
      await refetch();
      pushNotice("success", "Default model updated.");
    } catch (err: any) {
      const message = err.message || "Failed to update default model.";
      setDefaultModelError(message);
      pushNotice("error", message);
    } finally {
      setSavingDefaultModel(false);
    }
  }

  /**
   * Utility function to handle save profile.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSaveProfile.
   *
   * @example
   * ```typescript
   * const output = handleSaveProfile();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSaveProfile() {
    const name = profileName().trim();
    if (!name) {
      setProfileError("Username is required.");
      return;
    }
    if (name.length > 80) {
      setProfileError("Username is too long (max 80 chars).");
      return;
    }
    try {
      setProfileSaving(true);
      setProfileError("");
      await authApi.updateProfile({ name, timezone: profileTimezone().trim() || null });
      await refetchAccount();
      pushNotice("success", "Profile updated.");
    } catch (err: any) {
      const message = err.message || "Failed to update username.";
      setProfileError(message);
      pushNotice("error", message);
    } finally {
      setProfileSaving(false);
    }
  }

  /**
   * Utility function to handle save email.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSaveEmail.
   *
   * @example
   * ```typescript
   * const output = handleSaveEmail();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSaveEmail() {
    const email = emailValue().trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (!emailCurrentPassword()) {
      setEmailError("Current password is required.");
      return;
    }
    try {
      setEmailSaving(true);
      setEmailError("");
      await authApi.updateEmail({ email, currentPassword: emailCurrentPassword() });
      setEmailCurrentPassword("");
      await refetchAccount();
      pushNotice("success", "Email updated.");
    } catch (err: any) {
      const message = err.message || "Failed to update email.";
      setEmailError(message);
      pushNotice("error", message);
    } finally {
      setEmailSaving(false);
    }
  }

  /**
   * Utility function to handle save password.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleSavePassword.
   *
   * @example
   * ```typescript
   * const output = handleSavePassword();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleSavePassword() {
    if (!passwordCurrent()) {
      setPasswordError("Current password is required.");
      return;
    }
    if (!passwordNext() || passwordNext().length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    if (passwordNext() !== passwordConfirm()) {
      setPasswordError("Confirm password does not match.");
      return;
    }
    try {
      setPasswordSaving(true);
      setPasswordError("");
      await authApi.updatePassword({
        currentPassword: passwordCurrent(),
        newPassword: passwordNext(),
      });
      setPasswordCurrent("");
      setPasswordNext("");
      setPasswordConfirm("");
      pushNotice("success", "Password updated.");
    } catch (err: any) {
      const message = err.message || "Failed to update password.";
      setPasswordError(message);
      pushNotice("error", message);
    } finally {
      setPasswordSaving(false);
    }
  }

  /**
   * Utility function to request delete provider.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param id - Input value for requestDeleteProvider.
   * @returns Return value from requestDeleteProvider.
   *
   * @example
   * ```typescript
   * const output = requestDeleteProvider(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function requestDeleteProvider(id: string) {
    setConfirmState({
      kind: "delete-provider",
      id,
      title: "Delete connection?",
      description: "This provider connection will be removed from Settings.",
      actionLabel: "Delete",
    });
  }

  /**
   * Utility function to request revoke webhook secret.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param id - Input value for requestRevokeWebhookSecret.
   * @returns Return value from requestRevokeWebhookSecret.
   *
   * @example
   * ```typescript
   * const output = requestRevokeWebhookSecret(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function requestRevokeWebhookSecret(id: string) {
    setConfirmState({
      kind: "revoke-secret",
      id,
      title: "Revoke callback key?",
      description: "Callbacks using this key will stop working immediately.",
      actionLabel: "Revoke",
    });
  }

  /**
   * Utility function to execute confirm.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from executeConfirm.
   *
   * @example
   * ```typescript
   * const output = executeConfirm();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function executeConfirm() {
    const modal = confirmState();
    if (!modal) return;

    setConfirming(true);
    try {
      if (modal.kind === "delete-provider") {
        await settingsApi.deleteProvider(modal.id);
        await refetch();
        pushNotice("success", "Connection deleted.");
      } else {
        await settingsApi.revokeWebhookSecret(modal.id);
        await refetchWebhookSecrets();
        pushNotice("success", "Key revoked.");
      }
      setConfirmState(null);
    } catch (err: any) {
      pushNotice("error", err.message || "Action failed.");
    } finally {
      setConfirming(false);
    }
  }

  /**
   * Utility function to handle generate webhook secret.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleGenerateWebhookSecret.
   *
   * @example
   * ```typescript
   * const output = handleGenerateWebhookSecret();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleGenerateWebhookSecret() {
    try {
      setIsGeneratingWebhookKey(true);
      setWebhookErrorMsg("");
      setCopiedWebhookSecret(false);
      const created = (await settingsApi.createWebhookSecret({
        label: webhookLabel().trim() || undefined,
      })) as WebhookSecretRecord;

      setGeneratedWebhookSecret(created.secret || "");
      setWebhookLabel("");
      await refetchWebhookSecrets();
      pushNotice("success", "New callback key generated.");
    } catch (err: any) {
      const message = err.message || "Failed to generate callback secret";
      setWebhookErrorMsg(message);
      pushNotice("error", message);
    } finally {
      setIsGeneratingWebhookKey(false);
    }
  }

  /**
   * Utility function to handle copy generated webhook secret.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @returns Return value from handleCopyGeneratedWebhookSecret.
   *
   * @example
   * ```typescript
   * const output = handleCopyGeneratedWebhookSecret();
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function handleCopyGeneratedWebhookSecret() {
    try {
      const secret = generatedWebhookSecret();
      if (!secret) return;
      await navigator.clipboard.writeText(secret);
      setCopiedWebhookSecret(true);
      pushNotice("success", "Callback key copied.");
    } catch {
      setCopiedWebhookSecret(false);
      pushNotice("error", "Could not copy key.");
    }
  }

  /**
   * Utility function to copy example.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param kind - Input value for copyExample.
   * @param text - Input value for copyExample.
   * @returns Return value from copyExample.
   *
   * @example
   * ```typescript
   * const output = copyExample(value, value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function copyExample(kind: "unified", text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedExample(kind);
      window.setTimeout(() => setCopiedExample(""), 1400);
    } catch {
      pushNotice("error", "Could not copy example.");
    }
  }

  /**
   * Utility function to copy endpoint.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param kind - Input value for copyEndpoint.
   * @param value - Input value for copyEndpoint.
   * @returns Return value from copyEndpoint.
   *
   * @example
   * ```typescript
   * const output = copyEndpoint(value, value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  async function copyEndpoint(kind: "unified", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedEndpoint(kind);
      window.setTimeout(() => setCopiedEndpoint(""), 1400);
    } catch {
      pushNotice("error", "Could not copy endpoint.");
    }
  }

  /**
   * Utility function to toggle example.
   *
   * @remarks
   * Frontend utility used by the web app UI.
   * @param kind - Input value for toggleExample.
   * @returns Return value from toggleExample.
   *
   * @example
   * ```typescript
   * const output = toggleExample(value);
   * console.log(output);
   * ```
   * @throws {Error} Propagates runtime failures from dependent operations.
   */
  function toggleExample(kind: "unified") {
    setExpandedExamples((prev) => ({ ...prev, [kind]: !prev[kind] }));
  }

  return (
    <>
      <Title>Settings - Automation OS</Title>

      <SettingsShell
        activeSection={activeSection()}
        onSectionChange={setSection}
        notice={pageNotice}
      >
        <Show when={activeSection() === "account"}>
          <SettingsSectionAccount
            account={account}
            accountLoading={() => Boolean(account.loading)}
            profileName={profileName}
            setProfileName={setProfileName}
            profileError={profileError}
            setProfileError={setProfileError}
            profileSaving={profileSaving}
            canSaveProfile={canSaveProfile}
            profileDirty={profileDirty}
            handleSaveProfile={handleSaveProfile}
            profileTimezone={profileTimezone}
            setProfileTimezone={setProfileTimezone}
            emailValue={emailValue}
            setEmailValue={setEmailValue}
            emailCurrentPassword={emailCurrentPassword}
            setEmailCurrentPassword={setEmailCurrentPassword}
            emailError={emailError}
            setEmailError={setEmailError}
            emailSaving={emailSaving}
            canSaveEmail={canSaveEmail}
            emailDirty={emailDirty}
            handleSaveEmail={handleSaveEmail}
            passwordCurrent={passwordCurrent}
            setPasswordCurrent={setPasswordCurrent}
            passwordNext={passwordNext}
            setPasswordNext={setPasswordNext}
            passwordConfirm={passwordConfirm}
            setPasswordConfirm={setPasswordConfirm}
            passwordError={passwordError}
            setPasswordError={setPasswordError}
            passwordSaving={passwordSaving}
            passwordHasInput={passwordHasInput}
            canSavePassword={canSavePassword}
            handleSavePassword={handleSavePassword}
            runtimePreferences={runtimePreferences}
            runtimePreferencesLoading={() => Boolean(runtimePreferences.loading)}
            approvalModeSaving={approvalModeSaving}
            handleApprovalModeChange={handleApprovalModeChange}
          />
        </Show>

        <Show when={activeSection() === "connections"}>
          <SettingsSectionConnections
            providers={() => providers() || []}
            isAdding={isAdding}
            setIsAdding={setIsAdding}
            provider={provider}
            setProvider={setProvider}
            customName={customName}
            setCustomName={setCustomName}
            apiKey={apiKey}
            setApiKey={setApiKey}
            baseUrl={baseUrl}
            setBaseUrl={setBaseUrl}
            saving={saving}
            errorMsg={errorMsg}
            defaultModel={defaultModel}
            setDefaultModel={setDefaultModel}
            savingDefaultModel={savingDefaultModel}
            defaultModelError={defaultModelError}
            defaultModelDisplayLabel={defaultModelDisplayLabel}
            activeProviderConfig={activeProviderConfig}
            activeProviderName={activeProviderName}
            activeProviderModelsLoading={() => Boolean(activeProviderModels.loading)}
            defaultModelOptions={defaultModelOptions}
            handleSave={handleSave}
            resetForm={resetForm}
            handleSaveDefaultModel={handleSaveDefaultModel}
            handleSetActive={handleSetActive}
            requestDeleteProvider={requestDeleteProvider}
          />
        </Show>

        <Show when={activeSection() === "webhooks"}>
          <SettingsSectionWebhooks
            webhookErrorMsg={webhookErrorMsg}
            webhookLabel={webhookLabel}
            setWebhookLabel={setWebhookLabel}
            isGeneratingWebhookKey={isGeneratingWebhookKey}
            generatedWebhookSecret={generatedWebhookSecret}
            copiedWebhookSecret={copiedWebhookSecret}
            setGeneratedWebhookSecret={setGeneratedWebhookSecret}
            setCopiedWebhookSecret={setCopiedWebhookSecret}
            copiedEndpoint={copiedEndpoint}
            copiedExample={copiedExample}
            expandedExamples={expandedExamples}
            activeWebhookSecrets={activeWebhookSecrets}
            handleGenerateWebhookSecret={handleGenerateWebhookSecret}
            handleCopyGeneratedWebhookSecret={handleCopyGeneratedWebhookSecret}
            copyEndpoint={copyEndpoint}
            copyExample={copyExample}
            toggleExample={toggleExample}
            requestRevokeWebhookSecret={requestRevokeWebhookSecret}
          />
        </Show>
      </SettingsShell>

      <Show when={confirmState()}>
        {(modal) => (
          <div
            class="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={() => !confirming() && setConfirmState(null)}
          >
            <div
              class="bg-[#1a1a1a] border border-neutral-800/60 rounded-2xl shadow-2xl shadow-black/80 p-7 w-[430px] max-w-[calc(100vw-2rem)] animate-fade-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 class="text-[22px] font-semibold text-neutral-100 tracking-tight">{modal().title}</h3>
              <p class="text-neutral-400 mt-2 text-sm leading-relaxed">{modal().description}</p>

              <div class="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirmState(null)}
                  disabled={confirming()}
                  class="px-5 py-2.5 rounded-xl bg-neutral-800/60 text-neutral-300 hover:text-white border border-neutral-700/70 hover:bg-neutral-700/70 transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  onClick={executeConfirm}
                  disabled={confirming()}
                  class="px-5 py-2.5 rounded-xl bg-red-500/85 text-white hover:bg-red-500 transition-colors disabled:opacity-60"
                >
                  {confirming() ? "Working..." : modal().actionLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
