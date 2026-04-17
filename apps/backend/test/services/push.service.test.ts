import { afterEach, describe, expect, it } from "bun:test";
import { PushService, resetPushServiceForTests } from "../../src/services/notifications/push.service";
import { resetRuntimeConfigCache } from "../../src/config/runtime.config";

const originalNodeEnv = process.env.NODE_ENV;
const originalPublic = process.env.VAPID_PUBLIC_KEY;
const originalPrivate = process.env.VAPID_PRIVATE_KEY;
const originalSubject = process.env.VAPID_SUBJECT;
const originalAutopilotHome = process.env.AUTOPILOT_HOME;
const originalOllamaUrl = process.env.OLLAMA_URL;
const originalCallbackBaseUrl = process.env.CALLBACK_BASE_URL;
const originalFrontendOrigin = process.env.FRONTEND_ORIGIN;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
  else process.env.VAPID_PUBLIC_KEY = originalPublic;
  if (originalPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = originalPrivate;
  if (originalSubject === undefined) delete process.env.VAPID_SUBJECT;
  else process.env.VAPID_SUBJECT = originalSubject;
  if (originalAutopilotHome === undefined) delete process.env.AUTOPILOT_HOME;
  else process.env.AUTOPILOT_HOME = originalAutopilotHome;
  if (originalOllamaUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = originalOllamaUrl;
  if (originalCallbackBaseUrl === undefined) delete process.env.CALLBACK_BASE_URL;
  else process.env.CALLBACK_BASE_URL = originalCallbackBaseUrl;
  if (originalFrontendOrigin === undefined) delete process.env.FRONTEND_ORIGIN;
  else process.env.FRONTEND_ORIGIN = originalFrontendOrigin;
  resetRuntimeConfigCache();
  resetPushServiceForTests();
});

describe("PushService", () => {
  it("fails fast in production when VAPID keys are missing", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    process.env.VAPID_SUBJECT = "mailto:admin@example.com";
    process.env.AUTOPILOT_HOME = `/tmp/push-service-test-${Date.now()}`;
    const mkdirResult = Bun.spawnSync({ cmd: ["mkdir", "-p", process.env.AUTOPILOT_HOME] });
    if (mkdirResult.exitCode !== 0) throw new Error("Failed to create AUTOPILOT_HOME for test");
    await Bun.write(
      `${process.env.AUTOPILOT_HOME}/config.json`,
      `${JSON.stringify({
        OLLAMA_URL: "https://ollama.example.com",
        CALLBACK_BASE_URL: "https://api.example.com",
        FRONTEND_ORIGIN: "https://app.example.com",
      }, null, 2)}\n`,
    );
    delete process.env.OLLAMA_URL;
    delete process.env.CALLBACK_BASE_URL;
    delete process.env.FRONTEND_ORIGIN;
    resetRuntimeConfigCache();
    resetPushServiceForTests();

    expect(() => PushService.getPublicKey()).toThrow("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");
  });
});
