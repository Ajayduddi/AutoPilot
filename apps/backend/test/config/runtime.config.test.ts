/**
 * @fileoverview Integration-style tests for runtime configuration loading,
 * validation, persistence, and cache behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getRuntimeConfig,
  primeRuntimeConfigCache,
  resetRuntimeConfigCache,
  RuntimeConfigValidationError,
  updateRuntimeConfigFile,
  updateRuntimeConfigFileAsync,
} from "../../src/config/runtime.config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetRuntimeConfigCache();
});

beforeEach(() => {
  resetRuntimeConfigCache();
});

function createTempDir(prefix: string) {
  const dir = `/tmp/${prefix}-${crypto.randomUUID()}`;
  const result = Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create temp dir: ${dir}`);
  }
  return dir;
}

async function withTempConfig(content: Record<string, unknown>) {
  const home = createTempDir("autopilot-runtime");
  await Bun.write(`${home}/config.json`, `${JSON.stringify(content, null, 2)}\n`);
  return home;
}

async function withBrokenTempConfig(raw: string) {
  const home = createTempDir("autopilot-runtime-broken");
  await Bun.write(`${home}/config.json`, raw);
  return home;
}

describe("runtime.config strict validation", () => {
  it("auto-creates config.json with defaults when missing", async () => {
    const home = createTempDir("autopilot-runtime-missing");
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.defaultTimezone).toBe("UTC");
    expect(cfg.ollamaUrl).toBe("http://localhost:11434");

    const configPath = `${home}/config.json`;
    expect(await Bun.file(configPath).exists()).toBe(true);

    const persisted = JSON.parse(await Bun.file(configPath).text());
    expect(persisted.approvalMode).toBe("default");
    expect(persisted.forceInteractiveQuestions).toBe(true);
    expect(persisted.MAX_UPLOAD_MB).toBe(25);
    expect(persisted.CONTEXT_MODE_MAX_RETRIEVAL).toBe(5);
    expect(persisted.CALLBACK_BASE_URL).toBeUndefined();
    expect(persisted.FRONTEND_ORIGIN).toBeUndefined();
    expect(persisted.OLLAMA_URL).toBeUndefined();
    expect(persisted.GOOGLE_CLIENT_SECRET).toBeUndefined();
    expect(persisted.FEATURE_STRUCTURED_LOGGING).toBeUndefined();
  });

  it("loads valid merged config", async () => {
    const home = await withTempConfig({
      forceInteractiveQuestions: true,
      DEFAULT_TIMEZONE: "UTC",
      MAX_UPLOAD_MB: 25,
      OLLAMA_URL: "http://localhost:11434",
      FEATURE_STRUCTURED_LOGGING: false,
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.CONTEXT_MODE_ENABLED = "true";
    process.env.FEATURE_STRUCTURED_LOGGING = "false";

    const cfg = getRuntimeConfig();
    expect(cfg.defaultTimezone).toBe("UTC");
    expect(cfg.features.typedContracts).toBe(true);
  });

  it("fails fast with deterministic field error on malformed values", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "not-a-url",
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.CONTEXT_MODE_ENABLED = "maybe";

    let thrown: unknown;
    try {
      getRuntimeConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RuntimeConfigValidationError);
    const message = String((thrown as Error).message || "");
    expect(message).toContain("CONTEXT_MODE_ENABLED");
    expect(message).toContain("OLLAMA_URL");
  });

  it("fails fast when config.json is unreadable JSON", async () => {
    const home = await withBrokenTempConfig("{ invalid-json ");
    process.env.AUTOPILOT_HOME = home;

    let thrown: unknown;
    try {
      getRuntimeConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RuntimeConfigValidationError);
    const message = String((thrown as Error).message || "");
    expect(message).toContain("configPath");
    expect(message).toContain("Parse/read error");
  });

  it("fails fast in production when critical URLs are not explicitly configured", async () => {
    const home = await withTempConfig({
      DEFAULT_TIMEZONE: "UTC",
      FEATURE_STRUCTURED_LOGGING: false,
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.NODE_ENV = "production";

    let thrown: unknown;
    try {
      getRuntimeConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RuntimeConfigValidationError);
    const message = String((thrown as Error).message || "");
    expect(message).toContain("OLLAMA_URL");
    expect(message).toContain("CALLBACK_BASE_URL");
    expect(message).toContain("FRONTEND_ORIGIN");
  });

  it("fails fast in production when critical URLs still point to loopback hosts", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      CALLBACK_BASE_URL: "http://127.0.0.1:3000",
      FRONTEND_ORIGIN: "http://localhost:5173",
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.NODE_ENV = "production";

    let thrown: unknown;
    try {
      getRuntimeConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RuntimeConfigValidationError);
    const message = String((thrown as Error).message || "");
    expect(message).toContain("OLLAMA_URL");
    expect(message).toContain("CALLBACK_BASE_URL");
    expect(message).toContain("FRONTEND_ORIGIN");
    expect(message).toContain("loopback");
  });

  it("prefers config file values over environment overrides", async () => {
    const home = await withTempConfig({
      DEFAULT_TIMEZONE: "Asia/Kolkata",
      OLLAMA_URL: "http://localhost:11434",
      METRICS_ALLOW_PUBLIC: false,
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.DEFAULT_TIMEZONE = "UTC";
    process.env.METRICS_ALLOW_PUBLIC = "true";

    const cfg = getRuntimeConfig();
    expect(cfg.defaultTimezone).toBe("Asia/Kolkata");
    expect(cfg.metricsExporter.allowPublic).toBe(false);
  });

  it("caches loaded config until reset is called", async () => {
    const home = await withTempConfig({
      DEFAULT_TIMEZONE: "Asia/Kolkata",
      OLLAMA_URL: "http://localhost:11434",
    });
    process.env.AUTOPILOT_HOME = home;

    const first = getRuntimeConfig();
    expect(first.defaultTimezone).toBe("Asia/Kolkata");

    await Bun.write(
      `${home}/config.json`,
      `${JSON.stringify({ DEFAULT_TIMEZONE: "UTC", OLLAMA_URL: "http://localhost:11434" }, null, 2)}\n`,
    );

    const second = getRuntimeConfig();
    expect(second.defaultTimezone).toBe("Asia/Kolkata");

    resetRuntimeConfigCache();
    const third = getRuntimeConfig();
    expect(third.defaultTimezone).toBe("UTC");
  });

  it("persists runtime preference updates and reloads cache", async () => {
    const home = await withTempConfig({
      forceInteractiveQuestions: true,
      approvalMode: "default",
      OLLAMA_URL: "http://localhost:11434",
      EMBEDDING_MODEL: "text-embedding-004",
      SEMANTIC_SEARCH_TOP_K_DEFAULT: 8,
    });
    process.env.AUTOPILOT_HOME = home;

    const updated = updateRuntimeConfigFile({
      approvalMode: "auto",
      forceInteractiveQuestions: false,
      EMBEDDING_MODEL: "mistral-embed-2312",
      SEMANTIC_SEARCH_TOP_K_DEFAULT: 12,
    });

    expect(updated.approvalMode).toBe("auto");
    expect(updated.forceInteractiveQuestions).toBe(false);
    expect(updated.retrievalEmbedding.embeddingModel).toBe("mistral-embed-2312");
    expect(updated.retrievalEmbedding.semanticSearchTopKDefault).toBe(12);

    const persisted = JSON.parse(await Bun.file(`${home}/config.json`).text());
    expect(persisted.approvalMode).toBe("auto");
    expect(persisted.forceInteractiveQuestions).toBe(false);
    expect(persisted.EMBEDDING_MODEL).toBe("mistral-embed-2312");
    expect(persisted.SEMANTIC_SEARCH_TOP_K_DEFAULT).toBe(12);
  });

  it("persists runtime preference updates asynchronously for non-hot callers", async () => {
    const home = await withTempConfig({
      forceInteractiveQuestions: true,
      approvalMode: "default",
      OLLAMA_URL: "http://localhost:11434",
    });
    process.env.AUTOPILOT_HOME = home;

    const updated = await updateRuntimeConfigFileAsync({
      approvalMode: "auto",
      forceInteractiveQuestions: false,
    });

    expect(updated.approvalMode).toBe("auto");
    expect(updated.forceInteractiveQuestions).toBe(false);

    const persisted = JSON.parse(await Bun.file(`${home}/config.json`).text());
    expect(persisted.approvalMode).toBe("auto");
    expect(persisted.forceInteractiveQuestions).toBe(false);
  });

  it("normalizes centralized metrics exporter settings from config and env", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      METRICS_PUSHGATEWAY_URL: "https://metrics.example.com",
      METRICS_JOB_NAME: "autopilot-backend",
      METRICS_INSTANCE_ID: "instance-a",
      METRICS_PUSH_INTERVAL_MS: 12000,
      METRICS_PUSH_TIMEOUT_MS: 3000,
      METRICS_SNAPSHOT_ENABLED: true,
      METRICS_SNAPSHOT_PATH: "/tmp/autopilot-metrics.snapshot.json",
      METRICS_ALLOW_PUBLIC: false,
      METRICS_AUTH_TOKEN: "secret-token",
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.metricsExporter.pushgatewayUrl).toBe("https://metrics.example.com");
    expect(cfg.metricsExporter.jobName).toBe("autopilot-backend");
    expect(cfg.metricsExporter.instanceId).toBe("instance-a");
    expect(cfg.metricsExporter.pushIntervalMs).toBe(12000);
    expect(cfg.metricsExporter.pushTimeoutMs).toBe(3000);
    expect(cfg.metricsExporter.snapshotEnabled).toBe(true);
    expect(cfg.metricsExporter.snapshotPath).toBe("/tmp/autopilot-metrics.snapshot.json");
    expect(cfg.metricsExporter.allowPublic).toBe(false);
    expect(cfg.metricsExporter.authToken).toBe("secret-token");
  });

  it("centralizes auth and callback runtime settings", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      CALLBACK_BASE_URL: "https://api.example.com/",
      FRONTEND_ORIGIN: "https://app.example.com/",
      SESSION_TTL_DAYS: 21,
      AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE: false,
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.callbackBaseUrl).toBe("https://api.example.com");
    expect(cfg.auth.frontendOrigin).toBe("https://app.example.com");
    expect(cfg.auth.sessionTtlDays).toBe(21);
    expect(cfg.auth.revokeOtherSessionsOnPasswordChange).toBe(false);
  });

  it("centralizes google oauth, attachment scan, embedding api key, and mistral OCR settings", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      GOOGLE_REDIRECT_URI: "https://app.example.com/api/auth/google/callback",
      ATTACHMENT_SCAN_MODE: "http",
      ATTACHMENT_SCAN_FAIL_CLOSED: true,
      ATTACHMENT_SCAN_TIMEOUT_MS: 7000,
      ATTACHMENT_SCAN_HTTP_URL: "https://scanner.example.com/scan",
      ATTACHMENT_SCAN_HTTP_TOKEN: "scan-token",
      CLAMAV_HOST: "clamav.internal",
      CLAMAV_PORT: 3320,
      EMBEDDING_API_KEY: "embedding-api-key",
      MISTRAL_API_KEY: "mistral-api-key",
      MISTRAL_OCR_BASE_URL: "https://ocr.example.com/v1",
      MISTRAL_OCR_MODEL: "mistral-ocr-custom",
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.auth.google.clientId).toBe("google-client-id");
    expect(cfg.auth.google.clientSecret).toBe("google-client-secret");
    expect(cfg.auth.google.redirectUri).toBe("https://app.example.com/api/auth/google/callback");
    expect(cfg.attachmentScan.mode).toBe("http");
    expect(cfg.attachmentScan.failClosed).toBe(true);
    expect(cfg.attachmentScan.timeoutMs).toBe(7000);
    expect(cfg.attachmentScan.httpUrl).toBe("https://scanner.example.com/scan");
    expect(cfg.attachmentScan.httpToken).toBe("scan-token");
    expect(cfg.attachmentScan.clamavHost).toBe("clamav.internal");
    expect(cfg.attachmentScan.clamavPort).toBe(3320);
    expect(cfg.retrievalEmbedding.embeddingApiKey).toBe("embedding-api-key");
    expect(cfg.mistralOcr.apiKey).toBe("mistral-api-key");
    expect(cfg.mistralOcr.baseUrl).toBe("https://ocr.example.com/v1");
    expect(cfg.mistralOcr.model).toBe("mistral-ocr-custom");
  });

  it("centralizes provider key crypto and push vapid settings", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      PROVIDER_API_KEY_ENCRYPTION_KEY: "provider-encryption-key-32-bytes-min",
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.VAPID_PUBLIC_KEY = "public-vapid-key";
    process.env.VAPID_PRIVATE_KEY = "private-vapid-key";
    process.env.VAPID_SUBJECT = "mailto:ops@example.com";

    const cfg = getRuntimeConfig();
    expect(cfg.providerKeyCrypto.encryptionKey).toBe("provider-encryption-key-32-bytes-min");
    expect(cfg.push.vapidPublicKey).toBe("public-vapid-key");
    expect(cfg.push.vapidPrivateKey).toBe("private-vapid-key");
    expect(cfg.push.vapidSubject).toBe("mailto:ops@example.com");
  });

  it("centralizes document extraction xlsx limits", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      XLSX_MAX_COLS: 24,
      XLSX_MAX_ROWS_RENDER_PER_SHEET: 250,
      XLSX_MAX_ROWS_PARSE_PER_SHEET: 22000,
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.extraction.xlsxMaxCols).toBe(24);
    expect(cfg.extraction.xlsxMaxRowsRenderPerSheet).toBe(250);
    expect(cfg.extraction.xlsxMaxRowsParsePerSheet).toBe(22000);
  });

  it("centralizes llm and auto-router operational tuning knobs", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      WORKFLOW_CONTEXT_CACHE_TTL_MS: 45000,
      LLM_INTENT_WORKFLOW_SHORTLIST: 6,
      LLM_REPLY_WORKFLOW_SHORTLIST: 9,
      AUTO_ROUTER_DISCOVERY_BREAKER_FAILURES: 4,
      AUTO_ROUTER_DISCOVERY_BREAKER_COOLDOWN_MS: 60000,
      AUTO_ROUTER_DISCOVERY_TTL_MS: 900000,
      AUTO_ROUTER_DISCOVERY_TIMEOUT_MS: 7000,
      AUTO_ROUTER_MAX_MODELS_PER_PROVIDER: 5,
      AUTO_ROUTER_MAX_CANDIDATES: 11,
      AUTO_ROUTER_PREFERRED_REASONING_MODELS: "gpt-5,claude-3.7,gemini-2.5-pro",
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.llm.workflowContextCacheTtlMs).toBe(45000);
    expect(cfg.llm.intentWorkflowShortlist).toBe(6);
    expect(cfg.llm.replyWorkflowShortlist).toBe(9);
    expect(cfg.autoRouter.discoveryBreakerFailures).toBe(4);
    expect(cfg.autoRouter.discoveryBreakerCooldownMs).toBe(60000);
    expect(cfg.autoRouter.discoveryTtlMs).toBe(900000);
    expect(cfg.autoRouter.discoveryTimeoutMs).toBe(7000);
    expect(cfg.autoRouter.maxModelsPerProvider).toBe(5);
    expect(cfg.autoRouter.maxCandidates).toBe(11);
    expect(cfg.autoRouter.preferredReasoningModels).toEqual([
      "gpt-5",
      "claude-3.7",
      "gemini-2.5-pro",
    ]);
  });

  it("resolves relative uploadDir against the working directory", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      uploadDir: "tmp/runtime-uploads",
    });
    process.env.AUTOPILOT_HOME = home;

    const cfg = getRuntimeConfig();
    expect(cfg.uploadDir.endsWith("/tmp/runtime-uploads")).toBe(true);
  });

  it("can prime the runtime config cache before synchronous reads", async () => {
    const home = await withTempConfig({
      DEFAULT_TIMEZONE: "Asia/Kolkata",
      OLLAMA_URL: "http://localhost:11434",
    });
    process.env.AUTOPILOT_HOME = home;

    const primed = await primeRuntimeConfigCache();
    expect(primed.defaultTimezone).toBe("Asia/Kolkata");

    const syncRead = getRuntimeConfig();
    expect(syncRead.defaultTimezone).toBe("Asia/Kolkata");
  });
});
