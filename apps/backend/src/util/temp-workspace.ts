/**
 * @fileoverview apps/backend/src/util/temp-workspace.ts
 *
 * High-level purpose:
 * Shared backend utilities for operational concerns and low-level helpers.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable helper logic for runtime infrastructure.
 * - Supports observability, networking, and internal mechanics.
 * - Avoids duplication of common platform helper behavior.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use utility helpers where cross-domain reuse is needed.
 * 3. Keep helpers side-effect-light and composable.
 * 4. Verify callers after utility contract changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { ensureDir, readDir, removeDirRecursive, unlinkIfExists } from "./filesystem-compat";

type TempWorkspace = {
  root: string;
  resolve: (...parts: string[]) => string;
  createFile: (filename: string, bytes: Uint8Array) => Promise<string>;
  listEntries: () => Promise<string[]>;
  removeEntry: (entryPath: string) => Promise<void>;
  cleanup: () => Promise<void>;
};

declare const Bun: {
  write(path: string, data: string | Blob | ArrayBufferView | ArrayBuffer): Promise<number>;
};

function normalizePath(value: string): string {
  return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = normalizePath(part);
      if (index === 0) return normalized.replace(/\/+$/, "");
      return normalized.replace(/^\/+|\/+$/g, "");
    })
    .filter(Boolean)
    .join("/");
}

function basename(value: string): string {
  const normalized = normalizePath(value);
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function sanitizeFilename(name: string): string {
  return (
    String(name || "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120) || "file"
  );
}

function tempBaseDir(): string {
  return normalizePath(String(process.env.TMPDIR || process.env.TEMP || "/tmp")).replace(/\/+$/, "");
}

async function safeUnlink(filePath: string): Promise<void> {
  await unlinkIfExists(filePath);
}

export async function createTempWorkspace(prefix: string): Promise<TempWorkspace> {
  const root = joinPath(tempBaseDir(), `${sanitizeFilename(prefix)}-${crypto.randomUUID()}`);
  await ensureDir(root);

  return {
    root,
    resolve: (...parts: string[]) => joinPath(root, ...parts),
    async createFile(filename: string, bytes: Uint8Array) {
      const filePath = joinPath(root, `${crypto.randomUUID()}-${sanitizeFilename(basename(filename))}`);
      await Bun.write(filePath, bytes);
      return filePath;
    },
    async listEntries() {
      return await readDir(root);
    },
    async removeEntry(entryPath: string) {
      const target = entryPath.startsWith(root) ? entryPath : joinPath(root, entryPath);
      await safeUnlink(target);
    },
    async cleanup() {
      try {
        const entries = await readDir(root);
        await Promise.all(entries.map((entry) => safeUnlink(joinPath(root, entry))));
      } catch {
        // best effort cleanup
      }
      await removeDirRecursive(root);
    },
  };
}
