/**
 * @fileoverview apps/frontend/src/routes/settings.tsx
 *
 * High-level purpose:
 * Frontend route module that composes page-level UI, data loading, and user flows for navigation states.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Encapsulates route-scoped layout and state transitions.
 * - Coordinates API interactions with route-specific rendering behavior.
 * - Supports responsive UX patterns for authenticated and guest flows.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Create or update route component exports for target navigation path.
 * 2. Connect route logic to frontend API helpers and shared context providers.
 * 3. Validate route behavior on desktop and mobile with route/e2e tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { Title } from "@solidjs/meta";
import { useSearchParams } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js";
import {
  authApi,
  type AccountInfo,
  type MfaStatus,
  type ProviderModelCapabilities,
  type RetrievalPreferences,
  type RuntimePreferences,
  type TotpSetup,
  settingsApi,
} from "../lib/api";
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
  const [mfaStatus, { refetch: refetchMfaStatus }] = createResource<MfaStatus>(() => authApi.getMfaStatus());
  const [webhookSecrets, { refetch: refetchWebhookSecrets }] = createResource<WebhookSecretRecord[]>(
    () => settingsApi.getWebhookSecrets(),
  );
  const [runtimePreferences, { refetch: refetchRuntimePreferences }] = createResource<RuntimePreferences>(
    () => settingsApi.getRuntimePreferences(),
  );
  const [retrievalPreferences, { refetch: refetchRetrievalPreferences }] = createResource<RetrievalPreferences>(
    () => settingsApi.getRetrievalPreferences(),
  );
  const [providerModelCapabilities, { refetch: refetchProviderModelCapabilities }] = createResource<ProviderModelCapabilities>(
    () => settingsApi.getProviderModelCapabilities({ embeddingOnly: true }),
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
  const [mfaSetup, setMfaSetup] = createSignal<TotpSetup | null>(null);
  const [mfaCode, setMfaCode] = createSignal("");
  const [mfaDisableCode, setMfaDisableCode] = createSignal("");
  const [mfaDisablePassword, setMfaDisablePassword] = createSignal("");
  const [mfaSaving, setMfaSaving] = createSignal(false);
  const [mfaError, setMfaError] = createSignal("");
  const [retrievalDraft, setRetrievalDraft] = createSignal<RetrievalPreferences | null>(null);
  const [retrievalSaving, setRetrievalSaving] = createSignal(false);
  const [retrievalError, setRetrievalError] = createSignal("");
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
  const currentDefaultModelDisplayLabel = createMemo(() => {
    const active = activeProviderConfig();
    if (!active) return "Not set";
    const savedModel = String(active.model || "").trim();
    if (!savedModel || savedModel.toLowerCase() === "dynamic" || savedModel.toLowerCase() === "auto") {
      return "Auto (Agent picks best model/provider)";
    }
    return `${providerLabel(active.provider || "")}: ${savedModel}`;
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
  const mfaEnabled = createMemo(() => Boolean(mfaStatus()?.enabled));
  const mfaPendingSetup = createMemo(() => Boolean(mfaSetup() || mfaStatus()?.pending));

  createEffect(() => {
    const data = account();
    if (!data) return;
    setProfileName(data.name || "");
    setProfileTimezone(data.timezone || "");
    setEmailValue(data.email || "");
  });

  createEffect(() => {
    const data = retrievalPreferences();
    if (!data) return;
    setRetrievalDraft(data);
    setRetrievalError("");
  });

  const localEmbeddingModelSet = new Set(["Xenova/bge-small-en-v1.5", "Xenova/all-MiniLM-L6-v2"]);
  const retrievalModelProviderMap = createMemo(() => {
    const map: Record<string, { provider: string; providerConfigId: string; connectionName: string }> = {
      "Xenova/bge-small-en-v1.5": {
        provider: "bge_local",
        providerConfigId: "",
        connectionName: "BGE Local",
      },
      "Xenova/all-MiniLM-L6-v2": {
        provider: "minilm_local",
        providerConfigId: "",
        connectionName: "MiniLM Local",
      },
    };
    for (const group of providerModelCapabilities() || []) {
      if (group.status !== "ok") continue;
      for (const model of group.models || []) {
        const modelName = String(model.id || "").trim();
        if (!modelName) continue;
        map[modelName] = {
          provider: group.provider,
          providerConfigId: group.providerConfigId,
          connectionName: group.connectionName,
        };
      }
      const configured = String(group.configuredModel || "").trim();
      if (configured) {
        map[configured] = {
          provider: group.provider,
          providerConfigId: group.providerConfigId,
          connectionName: group.connectionName,
        };
      }
    }
    return map;
  });
  function isEmbeddingModelCandidate(modelId: string, raw?: Record<string, unknown>): boolean {
    const normalized = modelId.trim().toLowerCase();
    if (!normalized) return false;
    if (localEmbeddingModelSet.has(modelId.trim())) return true;
    if (
      normalized.includes("embedding")
      || normalized.includes("embed")
      || normalized.includes("bge")
      || normalized.includes("minilm")
      || normalized.includes("e5")
      || normalized.includes("gte")
    ) {
      return true;
    }

    const methods = Array.isArray(raw?.supportedGenerationMethods)
      ? raw.supportedGenerationMethods.map((v) => String(v || "").toLowerCase())
      : [];
    if (methods.some((m) => m.includes("embed"))) return true;
    return false;
  }

  const retrievalModelOptions = createMemo(() => {
    const options: Array<{ value: string; label: string }> = [
      { value: "Xenova/bge-small-en-v1.5", label: "BGE Small (Local): Xenova/bge-small-en-v1.5" },
      { value: "Xenova/all-MiniLM-L6-v2", label: "MiniLM (Local): Xenova/all-MiniLM-L6-v2" },
    ];
    const seen = new Set(options.map((item) => item.value));
    for (const group of providerModelCapabilities() || []) {
      if (group.status !== "ok") continue;
      for (const model of group.models || []) {
        const modelName = String(model.id || "").trim();
        if (!modelName || seen.has(modelName) || localEmbeddingModelSet.has(modelName)) continue;
        if (!isEmbeddingModelCandidate(modelName, model.raw)) continue;
        seen.add(modelName);
        options.push({
          value: modelName,
          label: `${group.connectionName}: ${modelName}`,
        });
      }
      const configured = String(group.configuredModel || "").trim();
      if (
        configured
        && !seen.has(configured)
        && !localEmbeddingModelSet.has(configured)
        && isEmbeddingModelCandidate(configured)
      ) {
        seen.add(configured);
        options.push({
          value: configured,
          label: `${group.connectionName}: ${configured} (configured)`,
        });
      }
    }
    const current = retrievalDraft()?.embeddingModel?.trim();
    if (current && !seen.has(current)) {
      options.push({ value: current, label: `Current: ${current}` });
    }
    return options;
  });

  function splitModelDisplayLabel(fullLabel: string, providerName?: string) {
    const label = String(fullLabel || "").trim();
    const provider = String(providerName || "").trim();
    if (!label) return { modelLabel: "Not set", badgeLabel: provider || "Unknown" };

    const prefix = provider ? `${provider}:` : "";
    if (prefix && label.startsWith(prefix)) {
      return {
        modelLabel: label.slice(prefix.length).trim(),
        badgeLabel: provider || "Unknown",
      };
    }

    const firstColon = label.indexOf(":");
    if (firstColon > 0) {
      return {
        modelLabel: label.slice(firstColon + 1).trim(),
        badgeLabel: label.slice(0, firstColon).trim(),
      };
    }

    return {
      modelLabel: label,
      badgeLabel: provider || "Unknown",
    };
  }

  const selectedRetrievalModelDisplay = createMemo(() => {
    const draft = retrievalDraft();
    if (!draft) return { modelLabel: "Not set", badgeLabel: "Unknown" };
    const model = draft.embeddingModel.trim();
    if (!model) return { modelLabel: "Not set", badgeLabel: "Unknown" };
    const option = retrievalModelOptions().find((item) => item.value === model);
    const source = retrievalModelProviderMap()[model];
    const providerName = source?.connectionName || (draft.embeddingProvider === "bge_local" ? "BGE Local" : draft.embeddingProvider === "minilm_local" ? "MiniLM Local" : "API Provider");
    return splitModelDisplayLabel(option?.label || model, providerName);
  });

  const savedRetrievalModelDisplay = createMemo(() => {
    const saved = retrievalPreferences();
    return splitModelDisplayLabel(
      saved?.currentEmbeddingModelLabel || "Not set",
      saved?.currentEmbeddingProviderLabel || "Unknown",
    );
  });

  function inferEmbeddingProviderFromModel(model: string): RetrievalPreferences["embeddingProvider"] {
    const normalized = model.trim();
    const sourceProvider = retrievalModelProviderMap()[normalized]?.provider;
    if (sourceProvider === "bge_local" || normalized === "Xenova/bge-small-en-v1.5") return "bge_local";
    if (sourceProvider === "minilm_local" || normalized === "Xenova/all-MiniLM-L6-v2") return "minilm_local";
    return "api";
  }

  function inferEmbeddingApiProviderFromModel(model: string): string {
    const normalized = model.trim();
    const sourceProvider = retrievalModelProviderMap()[normalized]?.provider;
    if (sourceProvider === "bge_local" || sourceProvider === "minilm_local") return "";
    return sourceProvider || "";
  }

  function inferEmbeddingApiProviderIdFromModel(model: string): string {
    const normalized = model.trim();
    return retrievalModelProviderMap()[normalized]?.providerConfigId || "";
  }

  const retrievalIsLocalProvider = createMemo(() => {
    const draft = retrievalDraft();
    if (!draft) return false;
    const provider = inferEmbeddingProviderFromModel(draft.embeddingModel || "");
    return provider === "bge_local" || provider === "minilm_local";
  });
  const retrievalValidationError = createMemo(() => {
    const draft = retrievalDraft();
    if (!draft) return "";
    const inIntRange = (value: number, min: number, max: number) =>
      Number.isInteger(value) && value >= min && value <= max;

    if (!inIntRange(draft.embeddingsIndexBatchSize, 1, 512)) return "Index batch size must be 1-512.";
    if (!inIntRange(draft.embeddingsRetryMaxAttempts, 1, 20)) return "Retry max attempts must be 1-20.";
    if (!inIntRange(draft.embeddingsRetryBaseDelayMs, 10, 60000)) return "Retry base delay must be 10-60000 ms.";
    if (!inIntRange(draft.embeddingVectorDimensions, 64, 4096)) return "Vector dimensions must be 64-4096.";
    if (!draft.embeddingModel.trim()) return "Embedding model is required.";
    if (!inIntRange(draft.embeddingMaxBatchSize, 1, 512)) return "Embedding max batch size must be 1-512.";
    if (!inIntRange(draft.semanticSearchTopKDefault, 1, 100)) return "Semantic search top-k must be 1-100.";
    if (Number.isNaN(draft.semanticSearchMinScore) || draft.semanticSearchMinScore < 0 || draft.semanticSearchMinScore > 1) {
      return "Semantic search min score must be between 0 and 1.";
    }
    if (!inIntRange(draft.ragMaxChunks, 1, 100)) return "RAG max chunks must be 1-100.";
    if (!inIntRange(draft.ragChunkTokenBudget, 64, 100000)) return "RAG chunk token budget must be 64-100000.";
    return "";
  });

  const retrievalDirty = createMemo(() => {
    const base = retrievalPreferences();
    const draft = retrievalDraft();
    if (!base || !draft) return false;
    const normalize = (value: RetrievalPreferences) => ({
      embeddingProvider: value.embeddingProvider,
      embeddingApiProvider: value.embeddingApiProvider,
      embeddingApiProviderId: value.embeddingApiProviderId,
      embeddingsIndexBatchSize: value.embeddingsIndexBatchSize,
      embeddingsRetryMaxAttempts: value.embeddingsRetryMaxAttempts,
      embeddingsRetryBaseDelayMs: value.embeddingsRetryBaseDelayMs,
      embeddingVectorDimensions: value.embeddingVectorDimensions,
      embeddingModel: value.embeddingModel,
      embeddingMaxBatchSize: value.embeddingMaxBatchSize,
      embeddingCacheDir: value.embeddingCacheDir,
      embeddingAllowRemoteModels: value.embeddingAllowRemoteModels,
      embeddingQuantized: value.embeddingQuantized,
      semanticSearchTopKDefault: value.semanticSearchTopKDefault,
      semanticSearchMinScore: value.semanticSearchMinScore,
      ragMaxChunks: value.ragMaxChunks,
      ragChunkTokenBudget: value.ragChunkTokenBudget,
    });
    const changed = JSON.stringify(normalize(base)) !== JSON.stringify(normalize(draft));
    return changed;
  });

  function updateRetrievalField<K extends keyof RetrievalPreferences>(key: K, value: RetrievalPreferences[K]) {
    setRetrievalDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [key]: value };
      if (key === "embeddingModel") {
        next.embeddingProvider = inferEmbeddingProviderFromModel(String(value));
        next.embeddingApiProvider = inferEmbeddingApiProviderFromModel(String(value));
        next.embeddingApiProviderId = inferEmbeddingApiProviderIdFromModel(String(value));
      }
      return next;
    });
  }

  async function handleSaveRetrieval() {
    const draft = retrievalDraft();
    if (!draft) return;
    const validationError = retrievalValidationError();
    if (validationError) {
      setRetrievalError(validationError);
      return;
    }

    try {
      setRetrievalSaving(true);
      setRetrievalError("");
      const derivedProvider = inferEmbeddingProviderFromModel(draft.embeddingModel);
      const derivedApiProvider = inferEmbeddingApiProviderFromModel(draft.embeddingModel);
      const derivedApiProviderId = inferEmbeddingApiProviderIdFromModel(draft.embeddingModel);
      const payload: Record<string, unknown> = {
        embeddingProvider: derivedProvider,
        embeddingApiProvider: derivedApiProvider,
        embeddingApiProviderId: derivedApiProviderId,
        embeddingsIndexBatchSize: draft.embeddingsIndexBatchSize,
        embeddingsRetryMaxAttempts: draft.embeddingsRetryMaxAttempts,
        embeddingsRetryBaseDelayMs: draft.embeddingsRetryBaseDelayMs,
        embeddingVectorDimensions: draft.embeddingVectorDimensions,
        embeddingModel: draft.embeddingModel.trim(),
        embeddingMaxBatchSize: draft.embeddingMaxBatchSize,
        embeddingCacheDir: draft.embeddingCacheDir.trim(),
        embeddingAllowRemoteModels: draft.embeddingAllowRemoteModels,
        embeddingQuantized: draft.embeddingQuantized,
        semanticSearchTopKDefault: draft.semanticSearchTopKDefault,
        semanticSearchMinScore: draft.semanticSearchMinScore,
        ragMaxChunks: draft.ragMaxChunks,
        ragChunkTokenBudget: draft.ragChunkTokenBudget,
      };

      await settingsApi.updateRetrievalPreferences(payload);
      await refetchRetrievalPreferences();
      pushNotice("success", "Retrieval settings updated.");
    } catch (err: any) {
      const message = err.message || "Failed to update retrieval settings.";
      setRetrievalError(message);
      pushNotice("error", message);
    } finally {
      setRetrievalSaving(false);
    }
  }

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

  function setSection(section: SettingsSection) {
    setSearchParams({ section, tab: undefined as unknown as string });
  }

  function pushNotice(tone: "success" | "error", message: string) {
    setPageNotice({ tone, message });
    window.setTimeout(() => setPageNotice(null), 2600);
  }

  function resetForm() {
    setProvider("ollama");
    setCustomName("");
    setApiKey("");
    setBaseUrl("");
    setErrorMsg("");
  }

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
      await refetchProviderModelCapabilities();
      pushNotice("success", "Connection saved.");
    } catch (err: any) {
      const message = err.message || "Failed to save provider config";
      setErrorMsg(message);
      pushNotice("error", message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSetActive(id: string) {
    try {
      await settingsApi.setActiveProvider(id);
      await refetch();
      await refetchActiveProviderModels();
      await refetchProviderModelCapabilities();
      pushNotice("success", "Active provider updated.");
    } catch (err: any) {
      pushNotice("error", err.message || "Error setting active provider.");
    }
  }

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

  async function handleSavePassword() {
    if (!passwordCurrent()) {
      setPasswordError("Current password is required.");
      return;
    }
    if (!passwordNext() || passwordNext().length < 12) {
      setPasswordError("New password must be at least 12 characters.");
      return;
    }
    if (!/[A-Za-z]/.test(passwordNext()) || !/\d/.test(passwordNext())) {
      setPasswordError("New password must include at least one letter and one number.");
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

  async function handleBeginTotpSetup() {
    try {
      setMfaSaving(true);
      setMfaError("");
      const setup = await authApi.beginTotpSetup();
      setMfaSetup(setup);
      setMfaCode("");
      await refetchMfaStatus();
      pushNotice("success", "Authenticator setup started.");
    } catch (err: any) {
      const message = err.message || "Failed to start TOTP setup.";
      setMfaError(message);
      pushNotice("error", message);
    } finally {
      setMfaSaving(false);
    }
  }

  async function handleEnableTotp() {
    const code = mfaCode().trim();
    if (!code) {
      setMfaError("Authenticator code is required.");
      return;
    }
    try {
      setMfaSaving(true);
      setMfaError("");
      await authApi.enableTotp({ code });
      setMfaSetup(null);
      setMfaCode("");
      await Promise.all([refetchMfaStatus(), refetchAccount()]);
      pushNotice("success", "TOTP MFA enabled.");
    } catch (err: any) {
      const message = err.message || "Failed to enable TOTP MFA.";
      setMfaError(message);
      pushNotice("error", message);
    } finally {
      setMfaSaving(false);
    }
  }

  async function handleDisableTotp() {
    const code = mfaDisableCode().trim();
    if (!code) {
      setMfaError("Authenticator code is required.");
      return;
    }
    if (account()?.hasPassword && !mfaDisablePassword()) {
      setMfaError("Current password is required to disable MFA.");
      return;
    }
    try {
      setMfaSaving(true);
      setMfaError("");
      await authApi.disableTotp({
        code,
        currentPassword: account()?.hasPassword ? mfaDisablePassword() : undefined,
      });
      setMfaDisableCode("");
      setMfaDisablePassword("");
      setMfaSetup(null);
      await Promise.all([refetchMfaStatus(), refetchAccount()]);
      pushNotice("success", "TOTP MFA disabled.");
    } catch (err: any) {
      const message = err.message || "Failed to disable TOTP MFA.";
      setMfaError(message);
      pushNotice("error", message);
    } finally {
      setMfaSaving(false);
    }
  }

  async function handleCopyTotpSecret(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      pushNotice("success", "Copied to clipboard.");
    } catch {
      pushNotice("error", "Could not copy code.");
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
        await refetchProviderModelCapabilities();
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
            mfaStatus={mfaStatus}
            mfaSetup={mfaSetup}
            mfaCode={mfaCode}
            setMfaCode={setMfaCode}
            mfaDisableCode={mfaDisableCode}
            setMfaDisableCode={setMfaDisableCode}
            mfaDisablePassword={mfaDisablePassword}
            setMfaDisablePassword={setMfaDisablePassword}
            mfaSaving={mfaSaving}
            mfaError={mfaError}
            handleBeginTotpSetup={handleBeginTotpSetup}
            handleEnableTotp={handleEnableTotp}
            handleDisableTotp={handleDisableTotp}
            handleCopyTotpSecret={handleCopyTotpSecret}
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
            currentDefaultModelDisplayLabel={currentDefaultModelDisplayLabel}
            activeProviderConfig={activeProviderConfig}
            activeProviderName={activeProviderName}
            activeProviderModelsLoading={() => Boolean(activeProviderModels.loading)}
            defaultModelOptions={defaultModelOptions}
            handleSave={handleSave}
            resetForm={resetForm}
            handleSaveDefaultModel={handleSaveDefaultModel}
            handleSetActive={handleSetActive}
            requestDeleteProvider={requestDeleteProvider}
            retrievalPreferencesLoading={() => Boolean(retrievalPreferences.loading)}
            retrievalPreferences={retrievalPreferences}
            retrievalDraft={retrievalDraft}
            retrievalModelOptions={retrievalModelOptions}
            retrievalModelOptionsLoading={() => Boolean(providerModelCapabilities.loading)}
            selectedRetrievalModelDisplay={selectedRetrievalModelDisplay}
            savedRetrievalModelDisplay={savedRetrievalModelDisplay}
            updateRetrievalField={updateRetrievalField}
            retrievalSaving={retrievalSaving}
            retrievalError={retrievalError}
            retrievalValidationError={retrievalValidationError}
            retrievalDirty={retrievalDirty}
            retrievalIsLocalProvider={retrievalIsLocalProvider}
            handleSaveRetrieval={handleSaveRetrieval}
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
