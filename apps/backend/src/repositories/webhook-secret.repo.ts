/**
 * @fileoverview repositories/webhook-secret.repo.
 *
 * Persistence helpers for webhook secret lifecycle and verification.
 */
import crypto from 'crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { webhookSecrets } from '../db/schema';

/** Prefix attached to generated plaintext webhook secrets. */
const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * Computes a stable SHA-256 hex digest for secret comparison/storage.
 */
export function hashWebhookSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

/**
 * Generates a new prefixed webhook secret value.
 */
function generateWebhookSecretValue(): string {
  const token = crypto.randomBytes(24).toString('base64url');
  return `${WEBHOOK_SECRET_PREFIX}${token}`;
}

/**
 * Returns the visible prefix stored for secret identification.
 */
function getSecretPrefix(secret: string): string {
  return secret.slice(0, 14);
}

/**
 * WebhookSecretRepo exported constant.
 */
export const WebhookSecretRepo = {
  /** Lists webhook secrets ordered by creation time (newest first). */
  async listSecrets() {
    return db.query.webhookSecrets.findMany({
      orderBy: desc(webhookSecrets.createdAt),
    });
  },

  /** Checks whether at least one non-revoked webhook secret exists. */
  async hasActiveSecrets() {
    const active = await db.query.webhookSecrets.findFirst({
      where: isNull(webhookSecrets.revokedAt),
      columns: { id: true },
    });
    return !!active;
  },

  async createSecret(input: { label: string; createdByUserId?: string | null }) {
    const secret = generateWebhookSecretValue();
    const [created] = await db.insert(webhookSecrets).values({
      id: `whk_${crypto.randomUUID()}`,
      label: input.label,
      secretPrefix: getSecretPrefix(secret),
      secretHash: hashWebhookSecret(secret),
      createdByUserId: input.createdByUserId ?? null,
    }).returning();
    return { created, secret };
  },

  /** Revokes an active webhook secret by ID. */
  async revokeSecret(id: string) {
    const [updated] = await db.update(webhookSecrets)
      .set({ revokedAt: new Date() })
      .where(and(eq(webhookSecrets.id, id), isNull(webhookSecrets.revokedAt)))
      .returning();
    return updated;
  },

  /** Finds an active secret row matching the provided plaintext secret. */
  async findActiveSecretByPlaintext(secret: string) {
    const secretHash = hashWebhookSecret(secret);
    return db.query.webhookSecrets.findFirst({
      where: and(eq(webhookSecrets.secretHash, secretHash), isNull(webhookSecrets.revokedAt)),
    });
  },

  /** Updates last-used timestamp for a webhook secret. */
  async markUsed(id: string) {
    await db.update(webhookSecrets)
      .set({ lastUsedAt: new Date() })
      .where(eq(webhookSecrets.id, id));
  },
};
