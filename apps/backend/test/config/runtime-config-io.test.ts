import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  ensureRuntimeConfigDir,
  primeRuntimeConfigText,
  readRuntimeConfigTextSync,
  resetRuntimeConfigIoCache,
  setRuntimeConfigIoBunForTests,
  writeRuntimeConfigText,
  writeRuntimeConfigTextSync,
} from "../../src/config/runtime-config-io";

function createTempDir(prefix: string) {
  const dir = `/tmp/${prefix}-${crypto.randomUUID()}`;
  const result = Bun.spawnSync({ cmd: ["mkdir", "-p", dir] });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create temp dir: ${dir}`);
  }
  return dir;
}

async function writeTempFile(contents: string) {
  const dir = createTempDir("autopilot-runtime-io");
  const filePath = `${dir}/config.json`;
  await Bun.write(filePath, contents);
  return filePath;
}

beforeEach(() => {
  resetRuntimeConfigIoCache();
  setRuntimeConfigIoBunForTests(undefined);
});

afterEach(() => {
  resetRuntimeConfigIoCache();
  setRuntimeConfigIoBunForTests(undefined);
});

describe("runtime-config-io", () => {
  it("uses Bun-backed priming when Bun is available", async () => {
    const filePath = await writeTempFile('{"a":1}\n');
    let bunReadCount = 0;

    setRuntimeConfigIoBunForTests({
      file(pathArg: string) {
        expect(pathArg).toBe(filePath);
        return {
          exists: async () => true,
          text: async () => {
            bunReadCount += 1;
            return '{"primed":true}\n';
          },
        };
      },
    });

    await primeRuntimeConfigText(filePath);

    expect(bunReadCount).toBe(1);
    expect(readRuntimeConfigTextSync(filePath)).toBe('{"primed":true}\n');
  });

  it("falls back to sync read if Bun priming throws", async () => {
    const filePath = await writeTempFile('{"fallback":true}\n');

    setRuntimeConfigIoBunForTests({
      file() {
        return {
          exists: async () => true,
          text: async () => {
            throw new Error("bun text failure");
          },
        };
      },
    });

    await primeRuntimeConfigText(filePath);

    expect(readRuntimeConfigTextSync(filePath)).toBe('{"fallback":true}\n');
  });

  it("keeps sync writes visible through the cache", async () => {
    const filePath = await writeTempFile('{"old":true}\n');

    writeRuntimeConfigTextSync(filePath, '{"new":true}\n');

    expect(readRuntimeConfigTextSync(filePath)).toBe('{"new":true}\n');
    expect(await Bun.file(filePath).text()).toBe('{"new":true}\n');
  });

  it("uses Bun-backed async writes when available", async () => {
    const filePath = await writeTempFile('{"old":true}\n');
    let writes = 0;

    setRuntimeConfigIoBunForTests({
      file() {
        return {
          exists: async () => true,
          text: async () => '{"old":true}\n',
        };
      },
      write: async (pathArg: string, content: string) => {
        writes += 1;
        expect(pathArg).toBe(filePath);
        expect(content).toBe('{"async":true}\n');
        await Bun.write(pathArg, content);
      },
    });

    await writeRuntimeConfigText(filePath, '{"async":true}\n');

    expect(writes).toBe(1);
    expect(readRuntimeConfigTextSync(filePath)).toBe('{"async":true}\n');
  });

  it("falls back to fs async writes when Bun write is unavailable", async () => {
    const filePath = await writeTempFile('{"old":true}\n');

    setRuntimeConfigIoBunForTests(null);
    await writeRuntimeConfigText(filePath, '{"fallbackAsync":true}\n');

    expect(readRuntimeConfigTextSync(filePath)).toBe('{"fallbackAsync":true}\n');
    expect(await Bun.file(filePath).text()).toBe('{"fallbackAsync":true}\n');
  });

  it("can create runtime config directories asynchronously", async () => {
    const root = createTempDir("autopilot-runtime-io-dir");
    const dirPath = `${root}/nested/runtime`;

    await ensureRuntimeConfigDir(dirPath);

    const statResult = Bun.spawnSync({ cmd: ["test", "-d", dirPath] });
    expect(statResult.exitCode).toBe(0);
  });
});
