/**
 * @fileoverview End-to-end health endpoint tests for readiness/liveness checks.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { healthRouter } from "../../src/routes/health";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { db } from "../../src/db";
import { RuntimeConfigManager } from "../../src/config/runtime.config";
import { WebhookSecretRepo } from "../../src/repositories/webhook-secret.repo";
import { PromptContextService } from "../../src/services/context/prompt-context.service";
import { ContextService } from "../../src/services/context/context.service";
import { EmbeddingService } from "../../src/services/retrieval/embedding.service";
import { ContextRepo } from "../../src/repositories/context.repo";

// We don't need to mock DB here as the basic health check shouldn't touch it.
// /ready check might fail if DB is offline, but we are testing contract.

afterEach(() => {
  restoreMocks();
});

describe("Health API Endpoints (/health)", () => {
  function createTempDir(prefix: string) {
    const dir = `/tmp/${prefix}-${crypto.randomUUID()}`;
    const result = Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create temp dir: ${dir}`);
    }
    return dir;
  }

  it("GET / - returns simple ok status", async () => {
    const app = buildApp();
    // note: health usually mounted at /health at root
    app.use("/health", healthRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.service).toBe("chat-automation-backend");
    } finally {
      await server.close();
    }
  });

  it("GET /metrics - returns prometheus plaintext format", async () => {
    const app = buildApp();
    app.use("/health", healthRouter);

    const originalGetHybridThreadContext = ContextService.getHybridThreadContext;
    const originalFormatForPrompt = ContextService.formatForPrompt;
    const originalEmbedText = EmbeddingService.embedText;
    const originalSearchSemanticInThread = ContextRepo.searchSemanticInThread;
    ContextService.resetSemanticThreadMemoryCacheForTests();
    (ContextService as any).getHybridThreadContext = async () => ([
      {
        id: "ctx_metrics",
        threadId: "thread_metrics",
        userId: "user_1",
        category: "thread_state",
        workflowRunId: null,
        workflowId: null,
        content: "Last workflow: metrics_review",
        summary: "Thread state",
        metadata: {},
        createdAt: new Date(),
        expiresAt: null,
      },
    ]);
    (ContextService as any).formatForPrompt = () => "=== RETRIEVED CONTEXT ===\n[Thread State]\n- Last workflow: metrics_review";
    (EmbeddingService as any).embedText = async () => ({
      vector: [0.1, 0.2, 0.3],
      modelInfo: { provider: "gemini", model: "text-embedding-004", dimensions: 3, maxBatchSize: 32 },
    });
    (ContextRepo as any).searchSemanticInThread = async () => ([
      {
        id: "ctx_summary",
        threadId: "thread_metrics",
        userId: "user_1",
        category: "chat_summary",
        workflowRunId: null,
        workflowId: null,
        content: "The renewal note was discussed before.",
        summary: "Renewal note",
        metadata: { summaryKind: "entity", importance: "medium" },
        createdAt: new Date(),
        expiresAt: null,
        similarity: 0.92,
        sourceType: "chat_summary",
      },
    ]);

    await PromptContextService.buildHybridThreadPromptContext({
      surface: "agent",
      threadId: "thread_metrics",
      userId: "user_1",
      query: "What did we do before?",
      temporalInput: { headerTimezone: "Asia/Kolkata" },
      categories: ["thread_state"],
    });
    await ContextService.searchSemanticThreadMemory({
      threadId: "thread_metrics",
      userId: "user_1",
      query: "What did we discuss earlier about the renewal note?",
      limit: 3,
    });
    await ContextService.searchSemanticThreadMemory({
      threadId: "thread_metrics",
      userId: "user_1",
      query: "What did we discuss earlier about the renewal note?",
      limit: 3,
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      // the trace middleware should have registered at least basic info
      expect(text).toContain("# HELP");
      expect(text).toContain("# TYPE");
      expect(text).toContain("autopilot_prompt_context_build_total");
      expect(text).toContain("autopilot_prompt_context_build_latency_ms");
      expect(text).toContain("autopilot_context_semantic_memory_cache_total");
      expect(text).toContain("autopilot_context_semantic_memory_search_latency_ms");
    } finally {
      ContextService.resetSemanticThreadMemoryCacheForTests();
      (ContextService as any).getHybridThreadContext = originalGetHybridThreadContext;
      (ContextService as any).formatForPrompt = originalFormatForPrompt;
      (EmbeddingService as any).embedText = originalEmbedText;
      (ContextRepo as any).searchSemanticInThread = originalSearchSemanticInThread;
      await server.close();
    }
  });

  it("GET /metrics - requires auth token in production when public metrics are disabled", async () => {
    const app = buildApp();
    app.use("/health", healthRouter);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowPublic = process.env.METRICS_ALLOW_PUBLIC;
    const originalMetricsToken = process.env.METRICS_AUTH_TOKEN;
    const originalAutopilotHome = process.env.AUTOPILOT_HOME;
    const originalOllamaUrl = process.env.OLLAMA_URL;
    const originalCallbackBaseUrl = process.env.CALLBACK_BASE_URL;
    const originalFrontendOrigin = process.env.FRONTEND_ORIGIN;
    process.env.NODE_ENV = "production";
    process.env.METRICS_ALLOW_PUBLIC = "false";
    process.env.METRICS_AUTH_TOKEN = "metrics_test_token";
    const home = createTempDir("autopilot-health-metrics");
    await Bun.write(
      `${home}/config.json`,
      `${JSON.stringify({
        OLLAMA_URL: "https://ollama.example.internal",
        CALLBACK_BASE_URL: "https://api.example.com",
        FRONTEND_ORIGIN: "https://app.example.com",
        METRICS_ALLOW_PUBLIC: false,
        METRICS_AUTH_TOKEN: "metrics_test_token",
      }, null, 2)}\n`,
    );
    process.env.AUTOPILOT_HOME = home;
    delete process.env.OLLAMA_URL;
    delete process.env.CALLBACK_BASE_URL;
    delete process.env.FRONTEND_ORIGIN;
    RuntimeConfigManager.resetRuntimeConfigCache();

    const server = await withServer(app);
    try {
      const unauthorized = await fetch(`${server.baseUrl}/health/metrics`);
      expect(unauthorized.status).toBe(404);

      const authorized = await fetch(`${server.baseUrl}/health/metrics`, {
        headers: {
          Authorization: "Bearer metrics_test_token",
        },
      });
      expect(authorized.status).toBe(200);
      expect(authorized.headers.get("content-type")).toContain("text/plain");
    } finally {
      if (typeof originalNodeEnv === "undefined") delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (typeof originalAllowPublic === "undefined") delete process.env.METRICS_ALLOW_PUBLIC;
      else process.env.METRICS_ALLOW_PUBLIC = originalAllowPublic;
      if (typeof originalMetricsToken === "undefined") delete process.env.METRICS_AUTH_TOKEN;
      else process.env.METRICS_AUTH_TOKEN = originalMetricsToken;
      if (typeof originalAutopilotHome === "undefined") delete process.env.AUTOPILOT_HOME;
      else process.env.AUTOPILOT_HOME = originalAutopilotHome;
      if (typeof originalOllamaUrl === "undefined") delete process.env.OLLAMA_URL;
      else process.env.OLLAMA_URL = originalOllamaUrl;
      if (typeof originalCallbackBaseUrl === "undefined") delete process.env.CALLBACK_BASE_URL;
      else process.env.CALLBACK_BASE_URL = originalCallbackBaseUrl;
      if (typeof originalFrontendOrigin === "undefined") delete process.env.FRONTEND_ORIGIN;
      else process.env.FRONTEND_ORIGIN = originalFrontendOrigin;
      RuntimeConfigManager.resetRuntimeConfigCache();
      await server.close();
    }
  });

  it("GET /ready - returns readiness checks with ok status when dependencies pass", async () => {
    const app = buildApp();
    app.use("/health", healthRouter);

    const originalExecute = db.execute;
    const originalGetRuntimeConfig = RuntimeConfigManager.getRuntimeConfig;
    const originalHasActiveSecrets = WebhookSecretRepo.hasActiveSecrets;
    const originalAuthCookieSecret = process.env.AUTH_COOKIE_SECRET;
    const originalProviderKey = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
    const originalWebhookSecret = process.env.WEBHOOK_CALLBACK_SECRET;

    (db as any).execute = async () => [{ "?column?": 1 }];
    (RuntimeConfigManager as any).getRuntimeConfig = () => ({
      configPath: ".autopilot/config.json",
      providerKeyCrypto: {
        encryptionKey: "test_provider_encryption_key_32_chars_min",
      },
    });
    (WebhookSecretRepo as any).hasActiveSecrets = async () => true;
    process.env.AUTH_COOKIE_SECRET = "test_secret_for_readiness";
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = "test_provider_encryption_key_32_chars_min";
    process.env.WEBHOOK_CALLBACK_SECRET = "whsec_test";

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health/ready`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.checks.runtimeConfig.ok).toBe(true);
      expect(json.checks.database.ok).toBe(true);
      expect(json.checks.webhookSecurity.ok).toBe(true);
      expect(json.checks.secrets.ok).toBe(true);
    } finally {
      (db as any).execute = originalExecute;
      (RuntimeConfigManager as any).getRuntimeConfig = originalGetRuntimeConfig;
      (WebhookSecretRepo as any).hasActiveSecrets = originalHasActiveSecrets;
      if (typeof originalAuthCookieSecret === "undefined") delete process.env.AUTH_COOKIE_SECRET;
      else process.env.AUTH_COOKIE_SECRET = originalAuthCookieSecret;
      if (typeof originalProviderKey === "undefined") delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
      else process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = originalProviderKey;
      if (typeof originalWebhookSecret === "undefined") delete process.env.WEBHOOK_CALLBACK_SECRET;
      else process.env.WEBHOOK_CALLBACK_SECRET = originalWebhookSecret;
      await server.close();
    }
  });

  it("GET /ready - returns 503 when database check fails", async () => {
    const app = buildApp();
    app.use("/health", healthRouter);

    const originalExecute = db.execute;
    (db as any).execute = async () => {
      throw new Error("db offline");
    };

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health/ready`);
      expect(res.status).toBe(503);
      const json = await res.json() as any;
      expect(json.status).toBe("error");
      expect(json.error.code).toBe("READINESS_FAILED");
    } finally {
      (db as any).execute = originalExecute;
      await server.close();
    }
  });

  it("GET /ready - hides detailed readiness checks from unauthenticated callers in production", async () => {
    const app = buildApp({ injectAuth: false });
    app.use("/health", healthRouter);

    const originalNodeEnv = process.env.NODE_ENV;
    const originalExecute = db.execute;
    const originalGetRuntimeConfig = RuntimeConfigManager.getRuntimeConfig;
    const originalHasActiveSecrets = WebhookSecretRepo.hasActiveSecrets;
    const originalAuthCookieSecret = process.env.AUTH_COOKIE_SECRET;
    const originalProviderKey = process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
    const originalWebhookSecret = process.env.WEBHOOK_CALLBACK_SECRET;

    process.env.NODE_ENV = "production";
    (db as any).execute = async () => [{ "?column?": 1 }];
    (RuntimeConfigManager as any).getRuntimeConfig = () => ({
      configPath: ".autopilot/config.json",
      providerKeyCrypto: {
        encryptionKey: "test_provider_encryption_key_32_chars_min",
      },
    });
    (WebhookSecretRepo as any).hasActiveSecrets = async () => true;
    process.env.AUTH_COOKIE_SECRET = "test_secret_for_readiness";
    process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = "test_provider_encryption_key_32_chars_min";
    process.env.WEBHOOK_CALLBACK_SECRET = "whsec_test";

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health/ready`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.checks).toBeUndefined();
    } finally {
      if (typeof originalNodeEnv === "undefined") delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      (db as any).execute = originalExecute;
      (RuntimeConfigManager as any).getRuntimeConfig = originalGetRuntimeConfig;
      (WebhookSecretRepo as any).hasActiveSecrets = originalHasActiveSecrets;
      if (typeof originalAuthCookieSecret === "undefined") delete process.env.AUTH_COOKIE_SECRET;
      else process.env.AUTH_COOKIE_SECRET = originalAuthCookieSecret;
      if (typeof originalProviderKey === "undefined") delete process.env.PROVIDER_API_KEY_ENCRYPTION_KEY;
      else process.env.PROVIDER_API_KEY_ENCRYPTION_KEY = originalProviderKey;
      if (typeof originalWebhookSecret === "undefined") delete process.env.WEBHOOK_CALLBACK_SECRET;
      else process.env.WEBHOOK_CALLBACK_SECRET = originalWebhookSecret;
      await server.close();
    }
  });
});
