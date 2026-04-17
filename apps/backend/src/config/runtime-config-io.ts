/**
 * @fileoverview config/runtime-config-io.
 *
 * High-level purpose:
 * Runtime configuration contracts, loading, and normalization for backend execution.
 *
 * Key Features (and trade-offs):
 * - Validates and shapes environment/runtime config values.
 * - Provides typed accessors for production-safe settings.
 * - Supports deterministic configuration behavior across environments.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new settings in centralized config contracts.
 * 3. Avoid scattering env access outside config modules.
 * 4. Typecheck and config tests should validate changes.
 * 5. Keep documentation aligned with behavior and tests.
 */

type BunFileHandle = {
  text(): Promise<string>;
  exists(): Promise<boolean>;
};

type BunRuntimeLike = {
  file(path: string): BunFileHandle;
  write?(path: string, content: string): Promise<unknown>;
};

const runtimeConfigTextCache = new Map<string, string | null>();
let bunRuntimeOverride: BunRuntimeLike | null | undefined;

type FsCompatLike = {
  accessSync(path: string): void;
  readFileSync(path: string, encoding: "utf8"): string;
  mkdirSync(path: string, options: { recursive: true }): void;
  writeFileSync(path: string, content: string, encoding: "utf8"): void;
  promises: {
    mkdir(path: string, options: { recursive: true }): Promise<void>;
    writeFile(path: string, content: string, encoding: "utf8"): Promise<void>;
  };
};

function getBunRuntime(): BunRuntimeLike | null {
  if (bunRuntimeOverride !== undefined) {
    return bunRuntimeOverride;
  }
  return (globalThis as { Bun?: BunRuntimeLike }).Bun ?? null;
}

function getFsCompat(): FsCompatLike {
  // Keep Node fs isolated to the synchronous compatibility path until all
  // sync config readers can be retired.
  return require("fs") as FsCompatLike;
}

export function resetRuntimeConfigIoCache(): void {
  runtimeConfigTextCache.clear();
}

export function setRuntimeConfigIoBunForTests(runtime: BunRuntimeLike | null | undefined): void {
  bunRuntimeOverride = runtime;
}

export function readRuntimeConfigTextSync(filePath: string): string | null {
  if (runtimeConfigTextCache.has(filePath)) {
    return runtimeConfigTextCache.get(filePath) ?? null;
  }

  try {
    getFsCompat().accessSync(filePath);
  } catch {
    runtimeConfigTextCache.set(filePath, null);
    return null;
  }

  const text = getFsCompat().readFileSync(filePath, "utf8");
  runtimeConfigTextCache.set(filePath, text);
  return text;
}

export async function primeRuntimeConfigText(filePath: string): Promise<void> {
  const bun = getBunRuntime();
  if (!bun) {
    readRuntimeConfigTextSync(filePath);
    return;
  }

  try {
    const file = bun.file(filePath);
    if (!(await file.exists())) {
      runtimeConfigTextCache.set(filePath, null);
      return;
    }

    const text = await file.text();
    runtimeConfigTextCache.set(filePath, text);
  } catch {
    // Preserve the synchronous compatibility path if Bun-backed priming fails.
    readRuntimeConfigTextSync(filePath);
  }
}

export function ensureRuntimeConfigDirSync(dirPath: string): void {
  getFsCompat().mkdirSync(dirPath, { recursive: true });
}

export async function ensureRuntimeConfigDir(dirPath: string): Promise<void> {
  // Bun currently does not expose a dedicated mkdir helper, so the async path
  // keeps a narrow compatibility fallback here.
  await getFsCompat().promises.mkdir(dirPath, { recursive: true });
}

export function writeRuntimeConfigTextSync(filePath: string, content: string): void {
  getFsCompat().writeFileSync(filePath, content, "utf8");
  runtimeConfigTextCache.set(filePath, content);
}

export async function writeRuntimeConfigText(filePath: string, content: string): Promise<void> {
  const bun = getBunRuntime();
  if (bun?.write) {
    await bun.write(filePath, content);
  } else {
    await getFsCompat().promises.writeFile(filePath, content, "utf8");
  }
  runtimeConfigTextCache.set(filePath, content);
}
