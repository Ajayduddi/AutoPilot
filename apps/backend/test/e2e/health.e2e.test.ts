import { afterEach, describe, expect, it } from "bun:test";
import { healthRouter } from "../../src/routes/health";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { db } from "../../src/db";
import { RuntimeConfigManager } from "../../src/config/runtime.config";
import { WebhookSecretRepo } from "../../src/repositories/webhook-secret.repo";

// We don't need to mock DB here as the basic health check shouldn't touch it.
// /ready check might fail if DB is offline, but we are testing contract.

afterEach(() => {
  restoreMocks();
});

describe("Health API Endpoints (/health)", () => {
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

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/health/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/plain");
      const text = await res.text();
      // the trace middleware should have registered at least basic info
      expect(text).toContain("# HELP");
      expect(text).toContain("# TYPE");
    } finally {
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
    (RuntimeConfigManager as any).getRuntimeConfig = () => ({ configPath: ".autopilot/config.json" });
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
});
