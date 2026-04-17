/**
 * @fileoverview services/attachment-storage.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { getRuntimeConfig } from '../../config/runtime.config';
import { ensureDir, unlinkIfExists } from '../../util/filesystem-compat';

declare const Bun: {
  write(path: string, data: string | Blob | ArrayBufferView | ArrayBuffer): Promise<number>;
};

function normalizePath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

function trimTrailingSlashes(value: string): string {
  return normalizePath(value).replace(/\/+$/, '');
}

function joinPath(...parts: string[]): string {
  return parts
    .map((part, index) => {
      const normalized = normalizePath(part);
      if (index === 0) return normalized.replace(/\/+$/, '');
      return normalized.replace(/^\/+|\/+$/g, '');
    })
    .filter(Boolean)
    .join('/');
}

function dirnamePath(value: string): string {
  const normalized = trimTrailingSlashes(value);
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return idx === 0 ? '/' : '.';
  return normalized.slice(0, idx);
}

function extname(value: string): string {
  const normalized = normalizePath(value);
  const slashIdx = normalized.lastIndexOf('/');
  const dotIdx = normalized.lastIndexOf('.');
  if (dotIdx <= slashIdx) return '';
  return normalized.slice(dotIdx);
}

function basenameWithoutExt(value: string, suffix: string): string {
  const normalized = normalizePath(value);
  const slashIdx = normalized.lastIndexOf('/');
  const base = slashIdx >= 0 ? normalized.slice(slashIdx + 1) : normalized;
  return suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const sanitizeFilename = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120) || 'file';

/**
 * AttachmentStorageService class.
 *
 * Encapsulates attachment storage service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AttachmentStorageService {
    static getUploadRoot() {
    return trimTrailingSlashes(getRuntimeConfig().uploadDir);
  }

    static async ensureUploadRoot() {
    await ensureDir(this.getUploadRoot());
  }

  static async saveFile(input: {
        userId: string;
    threadId?: string | null;
        filename: string;
        bytes: Uint8Array;
  }) {
    await this.ensureUploadRoot();

        const now = new Date();
        const datePath = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
        const safeName = sanitizeFilename(input.filename);
        const ext = extname(safeName).toLowerCase();
        const base = basenameWithoutExt(safeName, ext);
        const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
        const relPath = joinPath(
      'chat',
      input.userId,
      input.threadId || 'unbound',
      datePath,
      `${base}_${token}${ext}`,
    );
        const absolutePath = joinPath(this.getUploadRoot(), relPath);
    await ensureDir(dirnamePath(absolutePath));
    await Bun.write(absolutePath, input.bytes);

        const digestInput = new Uint8Array(input.bytes.byteLength);
        digestInput.set(input.bytes);
        const digest = await crypto.subtle.digest('SHA-256', digestInput);
        const checksum = bytesToHex(new Uint8Array(digest));
    return { absolutePath, relativePath: relPath, checksum };
  }

    static async removeFile(relativePath: string) {
        const absolutePath = joinPath(this.getUploadRoot(), relativePath);
    await unlinkIfExists(absolutePath);
  }
}
