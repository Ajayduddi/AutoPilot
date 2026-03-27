import crypto from 'crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db';
import { webhookSecrets } from '../db/schema';

const WEBHOOK_SECRET_PREFIX = 'whsec_';

export function hashWebhookSecret(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex');
}

function generateWebhookSecretValue(): string {
  const token = crypto.randomBytes(24).toString('base64url');
  return `${WEBHOOK_SECRET_PREFIX}${token}`;
}

function getSecretPrefix(secret: string): string {
  return secret.slice(0, 14);
}

export const WebhookSecretRepo = {
  async listSecrets() {
    return db.query.webhookSecrets.findMany({
      orderBy: desc(webhookSecrets.createdAt),
    });
  },

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

  async revokeSecret(id: string) {
    const [updated] = await db.update(webhookSecrets)
      .set({ revokedAt: new Date() })
      .where(and(eq(webhookSecrets.id, id), isNull(webhookSecrets.revokedAt)))
      .returning();
    return updated;
  },

  async findActiveSecretByPlaintext(secret: string) {
    const secretHash = hashWebhookSecret(secret);
    return db.query.webhookSecrets.findFirst({
      where: and(eq(webhookSecrets.secretHash, secretHash), isNull(webhookSecrets.revokedAt)),
    });
  },

  async markUsed(id: string) {
    await db.update(webhookSecrets)
      .set({ lastUsedAt: new Date() })
      .where(eq(webhookSecrets.id, id));
  },
};
