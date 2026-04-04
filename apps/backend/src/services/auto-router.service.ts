/**
 * @fileoverview services/auto-router.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { db } from "../db";
import { providerConfigs } from "../db/schema";
import { LLMFactory } from "../providers/llm/llm.factory";
import type { ILLMProvider } from "../providers/llm/provider.interface";
import { incrementCounter, observeHistogram } from "../util/metrics";
import { getRuntimeConfig } from "../config/runtime.config";

type ProviderConfigRow = typeof providerConfigs.$inferSelect;

type CandidateHealthStats = {
    successes: number;
    failures: number;
    avgLatencyMs: number;
  lastFailureAt?: number;
};

type ModelDiscoveryCacheEntry = {
    expiresAt: number;
    models: string[];
};

type CircuitState = {
    failureCount: number;
  openUntil?: number;
};

/**
 * AutoRouterCandidate type alias.
 */
export type AutoRouterCandidate = {
    candidateKey: string;
    providerConfigId: string;
    provider: string;
    providerLabel: string;
    model: string;
    mastraModel: string;
    score: number;
  scoreBreakdown: {
        quality: number;
        reliability: number;
        latency: number;
        defaultBonus: number;
  };
    providerInstance: ILLMProvider;
};

/**
 * AutoRouterDecision type alias.
 */
export type AutoRouterDecision = {
    mode: "auto" | "explicit";
  requestedProviderId?: string;
  requestedModel?: string;
    candidates: AutoRouterCandidate[];
  routingHint?: "default" | "reasoning_heavy";
  preferredModelPoolUsed?: boolean;
};

function normalizeProviderLabel(provider: string): string {
    const p = String(provider || "").trim().toLowerCase();
  if (!p) return "Provider";
  if (p === "ollama_cloud") return "Ollama";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function normalizeModelName(value?: string | null): string {
  return String(value || "").trim();
}

function qualityScoreForModel(modelName: string): number {
    const m = modelName.trim().toLowerCase();
  if (!m) return 0;

    let score = 48;
  if (/gpt-5|o3|o4|claude-3\.7|claude-3\.5|gemini-2\.5-pro|mistral-large|minimax|qwen3|qwen2\.5/.test(m)) score += 24;
  else if (/gpt-4\.1|gpt-4o|gemini-2\.5|mistral-medium|sonnet|reason/.test(m)) score += 18;
  else if (/pro|large|latest|thinking|reasoning/.test(m)) score += 10;
  else if (/flash|mini|small|instant/.test(m)) score -= 6;

  if (/\b(70b|72b|90b|110b|671b)\b/.test(m)) score += 8;
  if (/\b(8b|7b|4b|3b)\b/.test(m)) score -= 8;

  return Math.max(5, Math.min(100, score));
}

/**
 * AutoModelRouterService class.
 *
 * Encapsulates auto model router service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AutoModelRouterService {
  private static readonly DISCOVERY_TTL_MS = Number(process.env.AUTO_ROUTER_DISCOVERY_TTL_MS || "600000");
  private static readonly DISCOVERY_TIMEOUT_MS = Number(process.env.AUTO_ROUTER_DISCOVERY_TIMEOUT_MS || "4500");
  private static readonly MAX_DISCOVERED_MODELS_PER_PROVIDER = Number(process.env.AUTO_ROUTER_MAX_MODELS_PER_PROVIDER || "3");
  private static readonly DEFAULT_MAX_CANDIDATES = Number(process.env.AUTO_ROUTER_MAX_CANDIDATES || "8");
  private static readonly healthStats = new Map<string, CandidateHealthStats>();
  private static readonly modelCache = new Map<string, ModelDiscoveryCacheEntry>();
  private static readonly discoveryBreaker = new Map<string, CircuitState>();

    private static preferredReasoningModelHints(): string[] {
        const raw = String(
      process.env.AUTO_ROUTER_PREFERRED_REASONING_MODELS ||
        "glm-5,mistral-large,gpt-oss-120b,minimax-2.7,minimax-m2.7",
    );
    return raw
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

    private static isPreferredReasoningModel(modelName: string): boolean {
        const model = String(modelName || "").toLowerCase();
    if (!model) return false;
        const hints = this.preferredReasoningModelHints();
    return hints.some((hint) => model.includes(hint));
  }

    private static discoveryBreakerFailures(): number {
    return Math.max(1, getRuntimeConfig().autoRouter.discoveryBreakerFailures);
  }

    private static discoveryBreakerCooldownMs(): number {
    return Math.max(1_000, getRuntimeConfig().autoRouter.discoveryBreakerCooldownMs);
  }

    static isAutoSelection(providerId?: string, model?: string): boolean {
    return LLMFactory.isAutoSelection(providerId, model);
  }

    static reportSuccess(candidate: Pick<AutoRouterCandidate, "candidateKey">, latencyMs: number): void {
        const key = candidate.candidateKey;
        const prev = this.healthStats.get(key) || { successes: 0, failures: 0, avgLatencyMs: latencyMs };
        const nextSuccesses = prev.successes + 1;
        const nextAvgLatency =
      prev.successes > 0
        ? (prev.avgLatencyMs * prev.successes + latencyMs) / nextSuccesses
        : latencyMs;
    this.healthStats.set(key, {
      ...prev,
      successes: nextSuccesses,
      avgLatencyMs: Number.isFinite(nextAvgLatency) ? nextAvgLatency : prev.avgLatencyMs,
    });
    observeHistogram("autopilot_auto_router_candidate_latency_ms", latencyMs, { candidate: key });
  }

    static reportFailure(candidate: Pick<AutoRouterCandidate, "candidateKey">): void {
        const key = candidate.candidateKey;
        const prev = this.healthStats.get(key) || { successes: 0, failures: 0, avgLatencyMs: 2500 };
    this.healthStats.set(key, {
      ...prev,
      failures: prev.failures + 1,
      lastFailureAt: Date.now(),
    });
    incrementCounter("autopilot_auto_router_candidate_failure_total", { candidate: key });
  }

  static async resolveCandidates(input: {
    providerId?: string;
    model?: string;
    maxCandidates?: number;
    routingHint?: "default" | "reasoning_heavy";
  }): Promise<AutoRouterDecision> {
        const startedAt = Date.now();
        const maxCandidates = Math.max(1, input.maxCandidates || this.DEFAULT_MAX_CANDIDATES);
        const requestedProviderId = normalizeModelName(input.providerId);
        const requestedModel = normalizeModelName(input.model);
        const routingHint = input.routingHint || "default";
        const autoMode = this.isAutoSelection(requestedProviderId, requestedModel);

    if (!autoMode) {
            const config = await LLMFactory.getProviderConfig(requestedProviderId || undefined);
      if (!config) {
                const fallback = await LLMFactory.getDefaultProvider();
                const fallbackModel = requestedModel || "gpt-4o-mini";
                const provider = "openai";
                const synthetic: AutoRouterCandidate = {
          candidateKey: `fallback:${provider}:${fallbackModel}`,
          providerConfigId: "fallback-default",
          provider,
          providerLabel: normalizeProviderLabel(provider),
          model: fallbackModel,
          mastraModel: LLMFactory.resolveMastraModel(provider, fallbackModel),
          score: 50,
          scoreBreakdown: { quality: 50, reliability: 0, latency: 0, defaultBonus: 0 },
          providerInstance: fallback,
        };
        return {
          mode: "explicit",
          requestedProviderId: requestedProviderId || undefined,
          requestedModel: requestedModel || undefined,
          candidates: [synthetic],
          routingHint,
          preferredModelPoolUsed: false,
        };
      }

            const explicitModel = requestedModel && requestedModel.toLowerCase() !== "auto" ? requestedModel : undefined;
            const modelForCandidate = explicitModel || this.resolveModelForConfig(config);
            const candidate = await this.buildCandidate(config, modelForCandidate, true);
            const decision: AutoRouterDecision = {
        mode: "explicit",
        requestedProviderId: requestedProviderId || undefined,
        requestedModel: requestedModel || undefined,
        candidates: candidate ? [candidate] : [],
        routingHint,
        preferredModelPoolUsed: false,
      };
      observeHistogram("autopilot_auto_router_decision_latency_ms", Date.now() - startedAt, {
        mode: decision.mode,
        candidates: decision.candidates.length,
      });
      incrementCounter("autopilot_auto_router_decisions_total", { mode: decision.mode });
      return decision;
    }

        const configs = await db.query.providerConfigs.findMany();
        const candidates: AutoRouterCandidate[] = [];

    for (const cfg of configs) {
            const modelChoices = await this.resolveModelsForConfig(cfg);
      for (const modelName of modelChoices) {
                const candidate = await this.buildCandidate(cfg, modelName, cfg.isDefault);
        if (candidate) candidates.push(candidate);
      }
    }

    candidates.sort((a, b) => b.score - a.score);
        let preferredModelPoolUsed = false;
    if (routingHint === "reasoning_heavy") {
            const preferred = candidates.filter((c) => this.isPreferredReasoningModel(c.model));
      if (preferred.length > 0) {
                const rest = candidates.filter((c) => !this.isPreferredReasoningModel(c.model));
        candidates.splice(0, candidates.length, ...preferred, ...rest);
        preferredModelPoolUsed = true;
      }
    }
    if (candidates.length === 0) {
            const fallbackProvider = await LLMFactory.getDefaultProvider();
            const fallbackProviderName = "openai";
            const fallbackModel = "gpt-4o-mini";
      candidates.push({
        candidateKey: `fallback:${fallbackProviderName}:${fallbackModel}`,
        providerConfigId: "fallback-default",
        provider: fallbackProviderName,
        providerLabel: normalizeProviderLabel(fallbackProviderName),
        model: fallbackModel,
        mastraModel: LLMFactory.resolveMastraModel(fallbackProviderName, fallbackModel),
        score: qualityScoreForModel(fallbackModel),
        scoreBreakdown: {
          quality: qualityScoreForModel(fallbackModel),
          reliability: 0,
          latency: 0,
          defaultBonus: 0,
        },
        providerInstance: fallbackProvider,
      });
    }
        const decision: AutoRouterDecision = {
      mode: "auto",
      requestedProviderId: requestedProviderId || undefined,
      requestedModel: requestedModel || undefined,
      candidates: candidates.slice(0, maxCandidates),
      routingHint,
      preferredModelPoolUsed,
    };
    observeHistogram("autopilot_auto_router_decision_latency_ms", Date.now() - startedAt, {
      mode: decision.mode,
      candidates: decision.candidates.length,
    });
    incrementCounter("autopilot_auto_router_decisions_total", { mode: decision.mode });
    return decision;
  }

    private static resolveModelForConfig(config: ProviderConfigRow): string {
        const configured = normalizeModelName(config.model);
    if (configured && configured !== "dynamic" && configured !== "auto") return configured;
        const fallbackByProvider: Record<string, string> = {
      ollama: "llama3",
      ollama_cloud: "llama3.1:8b",
      gemini: "gemini-2.5-flash",
      mistral: "mistral-small-latest",
      groq: "llama-3.1-8b-instant",
      openai: "gpt-4o-mini",
    };
    return fallbackByProvider[config.provider] || "gpt-4o-mini";
  }

    private static async resolveModelsForConfig(config: ProviderConfigRow): Promise<string[]> {
        const configured = normalizeModelName(config.model);
        const fixedConfigured = configured && configured !== "dynamic" && configured !== "auto" ? configured : "";
    if (fixedConfigured) return [fixedConfigured];

        const discovered = await this.getDiscoveredModels(config);
    if (discovered.length > 0) return discovered.slice(0, this.MAX_DISCOVERED_MODELS_PER_PROVIDER);

    return [this.resolveModelForConfig(config)];
  }

  private static async buildCandidate(
    config: ProviderConfigRow,
    modelName: string,
    isDefault: boolean,
  ): Promise<AutoRouterCandidate | null> {
        const model = normalizeModelName(modelName);
    if (!model) return null;
    try {
            const providerInstance = LLMFactory.createProviderFromConfig(config, model);
            const stats = this.healthStats.get(`${config.id}::${model}`);
            const quality = qualityScoreForModel(model);
            const failureRate =
        stats && stats.successes + stats.failures > 0
          ? stats.failures / (stats.successes + stats.failures)
          : 0;
            const reliability = Math.round((1 - failureRate) * 12 - failureRate * 14);
            const latency = stats
        ? Math.max(-12, Math.min(12, Math.round((1800 - stats.avgLatencyMs) / 180)))
        : 0;
            const defaultBonus = isDefault ? 5 : 0;
            const reasoningTierBonus = this.isPreferredReasoningModel(model) ? 8 : 0;
            const score = quality + reliability + latency + defaultBonus + reasoningTierBonus;
      return {
        candidateKey: `${config.id}::${model}`,
        providerConfigId: config.id,
        provider: config.provider,
        providerLabel: normalizeProviderLabel(config.provider),
        model,
        mastraModel: LLMFactory.resolveMastraModel(config.provider, model),
        providerInstance,
        score,
        scoreBreakdown: {
          quality,
          reliability,
          latency,
          defaultBonus,
        },
      };
    } catch {
      return null;
    }
  }

    private static async getDiscoveredModels(config: ProviderConfigRow): Promise<string[]> {
        const cacheKey = config.id;
        const now = Date.now();
        const cached = this.modelCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.models;

    if (this.isDiscoveryCircuitOpen(cacheKey)) {
      incrementCounter("autopilot_auto_router_discovery_circuit_open_total", { providerConfigId: cacheKey });
      return [];
    }

        let models: string[] = [];
    try {
      models = await this.discoverModelsFromProvider(config);
      this.recordDiscoverySuccess(cacheKey);
    } catch {
      this.recordDiscoveryFailure(cacheKey);
      models = [];
    }

        const deduped = Array.from(new Set(models.map((m) => normalizeModelName(m)).filter(Boolean)));
    this.modelCache.set(cacheKey, {
      models: deduped,
      expiresAt: now + this.DISCOVERY_TTL_MS,
    });
    return deduped;
  }

    private static isDiscoveryCircuitOpen(key: string): boolean {
        const state = this.discoveryBreaker.get(key);
    if (!state?.openUntil) return false;
    if (state.openUntil <= Date.now()) {
      this.discoveryBreaker.delete(key);
      return false;
    }
    return true;
  }

    private static recordDiscoverySuccess(key: string): void {
    this.discoveryBreaker.delete(key);
  }

    private static recordDiscoveryFailure(key: string): void {
        const current = this.discoveryBreaker.get(key) || { failureCount: 0 };
        const failureCount = current.failureCount + 1;
    if (failureCount >= this.discoveryBreakerFailures()) {
      this.discoveryBreaker.set(key, {
        failureCount: 0,
        openUntil: Date.now() + this.discoveryBreakerCooldownMs(),
      });
      incrementCounter("autopilot_auto_router_discovery_circuit_trip_total", { providerConfigId: key });
      return;
    }
    this.discoveryBreaker.set(key, { failureCount });
  }

    private static async discoverModelsFromProvider(config: ProviderConfigRow): Promise<string[]> {
        const provider = String(config.provider || "").trim().toLowerCase();
        const apiKey = LLMFactory.decryptProviderApiKey(config.apiKey) || "";

    if (provider === "openai" || provider === "groq" || provider === "mistral") {
            const base = String(config.baseUrl || "").trim().replace(/\/$/, "");
      if (!base) return [];
            const response = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(this.DISCOVERY_TIMEOUT_MS),
      });
      if (!response.ok) return [];
            const data = await response.json().catch(() => ({} as any));
      return Array.isArray(data?.data) ? data.data.map((m: any) => String(m?.id || "").trim()).filter(Boolean) : [];
    }

    if (provider === "ollama" || provider === "ollama_cloud") {
            const base = String(config.baseUrl || (provider === "ollama_cloud" ? "https://ollama.com" : "http://localhost:11434"))
        .trim()
        .replace(/\/$/, "")
        .replace(/\/api\/openai\/v1$/i, "")
        .replace(/\/v1$/i, "");
            const response = await fetch(`${base}/api/tags`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        signal: AbortSignal.timeout(this.DISCOVERY_TIMEOUT_MS),
      });
      if (!response.ok) return [];
            const data = await response.json().catch(() => ({} as any));
      return Array.isArray(data?.models)
        ? data.models.map((m: any) => String(m?.name || "").trim()).filter(Boolean)
        : [];
    }

    if (provider === "gemini" && apiKey) {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
        signal: AbortSignal.timeout(this.DISCOVERY_TIMEOUT_MS),
      });
      if (!response.ok) return [];
            const data = await response.json().catch(() => ({} as any));
      return Array.isArray(data?.models)
        ? data.models
            .map((m: any) => String(m?.name || "").replace(/^models\//, "").trim())
            .filter(Boolean)
        : [];
    }

    return [];
  }
}
