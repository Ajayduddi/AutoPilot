/**
 * @fileoverview apps/backend/src/util/filesystem-compat.ts
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
type FsPromisesCompat = {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  unlink(path: string): Promise<void>;
  rm?(path: string, options: { recursive: true; force: true }): Promise<void>;
  rmdir(path: string): Promise<void>;
};

function getFsPromises(): FsPromisesCompat {
  return require("fs").promises as FsPromisesCompat;
}

export async function ensureDir(path: string): Promise<void> {
  await getFsPromises().mkdir(path, { recursive: true });
}

export async function readDir(path: string): Promise<string[]> {
  return await getFsPromises().readdir(path);
}

export async function unlinkIfExists(path: string): Promise<void> {
  try {
    await getFsPromises().unlink(path);
  } catch {
    // best effort cleanup
  }
}

export async function removeDirRecursive(path: string): Promise<void> {
  try {
    if (getFsPromises().rm) {
      await getFsPromises().rm!(path, { recursive: true, force: true });
    } else {
      await getFsPromises().rmdir(path);
    }
  } catch {
    // best effort cleanup
  }
}
