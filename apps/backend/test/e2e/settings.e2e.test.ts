import { afterEach, describe, expect, it, mock } from "bun:test";
import { settingsRouter } from "../../src/routes/settings.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { db } from "../../src/db";
import { RuntimeConfigManager } from "../../src/config/runtime.config";
import { UserRepo } from "../../src/repositories/user.repo";

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
});
