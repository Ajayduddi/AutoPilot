import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AttachmentStorageService } from "../../../src/services/attachments/attachment-storage.service";
import { resetRuntimeConfigCache, updateRuntimeConfigFileAsync } from "../../../src/config/runtime.config";

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
  const home = createTempDir("autopilot-attachment-storage");
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

describe("AttachmentStorageService", () => {
  it("uses the latest runtime uploadDir after config updates", async () => {
    const rootDir = createTempDir("autopilot-upload-root");
    const home = await withTempConfig({
      OLLAMA_URL: "http://localhost:11434",
      uploadDir: `${rootDir}/uploads-a`,
    });
    process.env.AUTOPILOT_HOME = home;

    const first = await AttachmentStorageService.saveFile({
      userId: "user_1",
      threadId: "thread_1",
      filename: "resume.md",
      bytes: new TextEncoder().encode("first"),
    });

    await updateRuntimeConfigFileAsync({
      uploadDir: `${rootDir}/uploads-b`,
    });

    const second = await AttachmentStorageService.saveFile({
      userId: "user_1",
      threadId: "thread_1",
      filename: "resume.md",
      bytes: new TextEncoder().encode("second"),
    });

    expect(first.absolutePath).toContain("/uploads-a/");
    expect(second.absolutePath).toContain("/uploads-b/");
    expect(first.absolutePath).not.toBe(second.absolutePath);
  });
});
