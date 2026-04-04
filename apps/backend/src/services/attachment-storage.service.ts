/**
 * @fileoverview services/attachment-storage.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { getRuntimeConfig } from '../config/runtime.config';

const DEFAULT_UPLOAD_DIR = getRuntimeConfig().uploadDir;

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
    return path.resolve(DEFAULT_UPLOAD_DIR);
  }

    static async ensureUploadRoot() {
    await fs.mkdir(this.getUploadRoot(), { recursive: true });
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
        const ext = path.extname(safeName).toLowerCase();
        const base = path.basename(safeName, ext);
        const token = randomUUID().replace(/-/g, '').slice(0, 12);
        const relPath = path.join(
      'chat',
      input.userId,
      input.threadId || 'unbound',
      datePath,
      `${base}_${token}${ext}`,
    );
        const absolutePath = path.join(this.getUploadRoot(), relPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from(input.bytes));

        const checksum = createHash('sha256').update(input.bytes).digest('hex');
    return { absolutePath, relativePath: relPath, checksum };
  }

    static async removeFile(relativePath: string) {
        const absolutePath = path.join(this.getUploadRoot(), relativePath);
    try {
      await fs.unlink(absolutePath);
    } catch {
      // best effort delete
    }
  }
}
