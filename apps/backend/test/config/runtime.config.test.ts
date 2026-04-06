import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { getRuntimeConfig, resetRuntimeConfigCache, RuntimeConfigValidationError } from "../../src/config/runtime.config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetRuntimeConfigCache();
});

beforeEach(() => {
  resetRuntimeConfigCache();
});

function withTempConfig(content: Record<string, unknown>) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-runtime-"));
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "config.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return home;
}

function withBrokenTempConfig(raw: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "autopilot-runtime-broken-"));
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "config.json"), raw, "utf8");
  return home;
}

describe("runtime.config strict validation", () => {
  it("loads valid merged config", () => {
    const home = withTempConfig({
      forceInteractiveQuestions: true,
      DEFAULT_TIMEZONE: "UTC",
      MAX_UPLOAD_MB: 25,
      OLLAMA_URL: "http://localhost:11434",
      FEATURE_TYPED_CONTRACTS: false,
      FEATURE_STRUCTURED_LOGGING: false,
    });
    process.env.AUTOPILOT_HOME = home;
    process.env.CONTEXT_MODE_ENABLED = "true";
    process.env.FEATURE_TYPED_CONTRACTS = "false";
    process.env.FEATURE_STRUCTURED_LOGGING = "false";

    const cfg = getRuntimeConfig();
    expect(cfg.defaultTimezone).toBe("UTC");
    expect(cfg.features.typedContracts).toBe(false);
  });

  it("fails fast with deterministic field error on malformed values", () => {
    const home = withTempConfig({
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

  it("fails fast when config.json is unreadable JSON", () => {
    const home = withBrokenTempConfig("{ invalid-json ");
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
});
