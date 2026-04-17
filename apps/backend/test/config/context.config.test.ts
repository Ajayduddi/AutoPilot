import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { contextConfig } from "../../src/config/context.config";
import { resetRuntimeConfigCache, updateRuntimeConfigFileAsync } from "../../src/config/runtime.config";

const ORIGINAL_ENV = { ...process.env };

function createTempDir(prefix: string) {
  const dir = `/tmp/${prefix}-${crypto.randomUUID()}`;
  const result = Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create temp dir: ${dir}`);
  }
  return dir;
}

async function withTempConfig(content: Record<string, unknown>) {
  const home = createTempDir("autopilot-context-config");
  await Bun.write(`${home}/config.json`, `${JSON.stringify(content, null, 2)}\n`);
  return home;
}

beforeEach(() => {
  resetRuntimeConfigCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetRuntimeConfigCache();
});

describe("context.config live view", () => {
  it("reflects runtime config updates without re-importing the module", async () => {
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      CONTEXT_MODE_ENABLED: false,
      CONTEXT_MODE_MAX_RETRIEVAL: 3,
    });
    process.env.AUTOPILOT_HOME = home;

    expect(contextConfig.enabled).toBe(false);
    expect(contextConfig.maxRetrieval).toBe(3);

    await updateRuntimeConfigFileAsync({
      CONTEXT_MODE_ENABLED: true,
      CONTEXT_MODE_MAX_RETRIEVAL: 9,
    });

    expect(contextConfig.enabled).toBe(true);
    expect(contextConfig.maxRetrieval).toBe(9);
  });
});
