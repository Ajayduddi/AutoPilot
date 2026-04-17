import { afterEach, describe, expect, it, mock } from "bun:test";
import { settingsRouter } from "../../../src/routes/settings.routes";
import { buildApp, restoreMocks, withServer } from "../helpers/test-server";
import { db } from "../../../src/db";
import { RuntimeConfigManager } from "../../../src/config/runtime.config";
import { UserRepo } from "../../../src/repositories/user.repo";

afterEach(() => {
  restoreMocks();
  mock.restore();
});

describe("Settings API Endpoints (/api/settings)", () => {
  it("GET /providers - returns available configured providers", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const originalProviderConfigs = db.query.providerConfigs;
    (db.query as any).providerConfigs = {
      findMany: async () => [
        { id: "pk_1", provider: "openai", model: "gpt-4", apiKey: "enc:v1:abc:def:ghi", createdAt: new Date(), updatedAt: new Date() },
      ]
    };

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/providers`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
    } finally {
      (db.query as any).providerConfigs = originalProviderConfigs;
      await server.close();
    }
  });

  it("GET /runtime-preferences - returns application settings", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const originalGetConfig = RuntimeConfigManager.getRuntimeConfig;
    (RuntimeConfigManager as any).getRuntimeConfig = () => ({
      approvalMode: "auto",
      forceInteractiveQuestions: true,
      modelFetch: { allowPrivate: false, timeoutMs: 5000, maxBytes: 500000 }
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/runtime-preferences`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data.approvalMode).toBe("auto");
    } finally {
      (RuntimeConfigManager as any).getRuntimeConfig = originalGetConfig;
      await server.close();
    }
  });

  it("GET /retrieval-preferences - omits hidden internal flags from the API contract", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const originalGetConfig = RuntimeConfigManager.getRuntimeConfig;
    (RuntimeConfigManager as any).getRuntimeConfig = () => ({
      approvalMode: "auto",
      forceInteractiveQuestions: true,
      modelFetch: { allowPrivate: false, timeoutMs: 5000, maxBytes: 500000 },
      retrievalEmbedding: {
        embeddingProvider: "bge_local",
        embeddingApiProvider: "",
        embeddingApiProviderId: "",
        embeddingsEnabled: true,
        embeddingsDebug: false,
        embeddingsIndexBatchSize: 32,
        embeddingsRetryMaxAttempts: 3,
        embeddingsRetryBaseDelayMs: 250,
        embeddingVectorDimensions: 768,
        embeddingModel: "Xenova/bge-small-en-v1.5",
        embeddingMaxBatchSize: 8,
        embeddingCacheDir: "",
        embeddingAllowRemoteModels: true,
        embeddingQuantized: true,
        semanticSearchTopKDefault: 8,
        semanticSearchMinScore: 0.65,
        ragMaxChunks: 8,
        ragChunkTokenBudget: 2400,
      },
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/retrieval-preferences`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data.embeddingProvider).toBe("bge_local");
      expect(json.data.currentEmbeddingProviderLabel).toBe("BGE Local");
      expect("embeddingsEnabled" in json.data).toBe(false);
      expect("embeddingsDebug" in json.data).toBe(false);
    } finally {
      (RuntimeConfigManager as any).getRuntimeConfig = originalGetConfig;
      await server.close();
    }
  });

  it("PATCH /retrieval-preferences - resolves API embedding models through the saved provider connection", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const originalGetConfig = RuntimeConfigManager.getRuntimeConfig;
    const originalUpdateConfig = RuntimeConfigManager.updateRuntimeConfigFileAsync;
    const originalProviderConfigs = db.query.providerConfigs;
    const originalUpdate = db.update;

    const runtimeUpdates: Record<string, unknown>[] = [];
    const providerUpdateCalls: Array<{ values: Record<string, unknown>; id?: string }> = [];
    const runtimeState = {
      approvalMode: "auto",
      forceInteractiveQuestions: true,
      modelFetch: { allowPrivate: false, timeoutMs: 5000, maxBytes: 500000 },
      retrievalEmbedding: {
        embeddingProvider: "api",
        embeddingApiProvider: "gemini",
        embeddingApiProviderId: "",
        embeddingsEnabled: true,
        embeddingsDebug: false,
        embeddingsIndexBatchSize: 32,
        embeddingsRetryMaxAttempts: 3,
        embeddingsRetryBaseDelayMs: 250,
        embeddingVectorDimensions: 768,
        embeddingModel: "text-embedding-004",
        embeddingMaxBatchSize: 32,
        embeddingCacheDir: "",
        embeddingAllowRemoteModels: true,
        embeddingQuantized: true,
        semanticSearchTopKDefault: 8,
        semanticSearchMinScore: 0.65,
        ragMaxChunks: 8,
        ragChunkTokenBudget: 2400,
      },
    };

    (RuntimeConfigManager as any).getRuntimeConfig = () => runtimeState;
    (RuntimeConfigManager as any).updateRuntimeConfigFileAsync = async (updates: Record<string, unknown>) => {
      runtimeUpdates.push(updates);
      if (updates.EMBEDDING_PROVIDER !== undefined) runtimeState.retrievalEmbedding.embeddingProvider = String(updates.EMBEDDING_PROVIDER);
      if (updates.EMBEDDING_API_PROVIDER !== undefined) runtimeState.retrievalEmbedding.embeddingApiProvider = String(updates.EMBEDDING_API_PROVIDER);
      if (updates.EMBEDDING_API_PROVIDER_ID !== undefined) runtimeState.retrievalEmbedding.embeddingApiProviderId = String(updates.EMBEDDING_API_PROVIDER_ID);
      if (updates.EMBEDDING_MODEL !== undefined) runtimeState.retrievalEmbedding.embeddingModel = String(updates.EMBEDDING_MODEL);
    };

    (db.query as any).providerConfigs = {
      findFirst: async () => ({
        id: "prov_mistral_embed",
        provider: "mistral",
        customName: "Mistral Embed",
        model: "mistral-embed-2312",
        apiKey: "enc:v1:test:test:test",
        baseUrl: "https://api.mistral.ai/v1",
        isDefault: false,
      }),
      findMany: async () => [],
    };

    (db as any).update = () => ({
      set(values: Record<string, unknown>) {
        return {
          async where() {
            providerUpdateCalls.push({ values, id: "prov_mistral_embed" });
            return [];
          },
        };
      },
    });

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/retrieval-preferences`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeddingProvider: "api",
          embeddingApiProvider: "mistral",
          embeddingApiProviderId: "prov_mistral_embed",
          embeddingModel: "mistral-embed-2312",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data.embeddingApiProvider).toBe("mistral");
      expect(json.data.embeddingApiProviderId).toBe("prov_mistral_embed");
      expect(json.data.currentEmbeddingProviderLabel).toBe("Mistral Embed");
      expect(runtimeUpdates.at(-1)).toEqual(expect.objectContaining({
        EMBEDDING_API_PROVIDER: "mistral",
        EMBEDDING_API_PROVIDER_ID: "prov_mistral_embed",
        EMBEDDING_MODEL: "mistral-embed-2312",
      }));
      expect(providerUpdateCalls).toContainEqual({
        values: { model: "mistral-embed-2312" },
        id: "prov_mistral_embed",
      });
    } finally {
      (RuntimeConfigManager as any).getRuntimeConfig = originalGetConfig;
      (RuntimeConfigManager as any).updateRuntimeConfigFileAsync = originalUpdateConfig;
      (db.query as any).providerConfigs = originalProviderConfigs;
      (db as any).update = originalUpdate;
      await server.close();
    }
  });

  it("POST /fetch-models - rejects remote discovery without a saved provider connection", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/settings/fetch-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "mistral",
          baseUrl: "https://api.mistral.ai/v1",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json() as any;
      expect(json.status).toBe("error");
      expect(String(json.message || "")).toContain("providerId is required");
    } finally {
      await server.close();
    }
  });

  it("POST /fetch-models - ignores request provider and baseUrl overrides when providerId is supplied", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/settings", settingsRouter);

    (UserRepo as any).canUseAsSingleUser = async () => true;

    const originalProviderConfigs = db.query.providerConfigs;
    const originalFetch = globalThis.fetch;
    const seenRequests: Array<{ url: string; authorization: string }> = [];

    (db.query as any).providerConfigs = {
      findFirst: async () => ({
        id: "prov_saved_mistral",
        provider: "mistral",
        model: "mistral-large-latest",
        apiKey: "saved-provider-secret",
        baseUrl: "https://api.mistral.ai/v1",
        isDefault: true,
      }),
    };

    const server = await withServer(app);
    try {
      (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith(server.baseUrl)) {
          return originalFetch(input, init);
        }
        seenRequests.push({
          url,
          authorization: String((init?.headers as Record<string, string> | undefined)?.Authorization || ""),
        });
        return new Response(JSON.stringify({
          data: [{ id: "mistral-embed-latest" }],
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const res = await originalFetch(`${server.baseUrl}/api/settings/fetch-models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "prov_saved_mistral",
          provider: "openai",
          baseUrl: "https://evil.example/v1",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data).toEqual(["mistral-embed-latest"]);
      expect(seenRequests).toHaveLength(1);
      expect(seenRequests[0]?.url).toBe("https://api.mistral.ai/v1/models");
      expect(seenRequests[0]?.authorization).toBe("Bearer saved-provider-secret");
    } finally {
      (db.query as any).providerConfigs = originalProviderConfigs;
      (globalThis as any).fetch = originalFetch;
      await server.close();
    }
  });
});
