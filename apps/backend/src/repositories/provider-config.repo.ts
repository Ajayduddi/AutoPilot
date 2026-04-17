/**
 * @fileoverview apps/backend/src/repositories/provider-config.repo.ts
 *
 * High-level purpose:
 * Data access repository layer for persistence operations and query composition.
 *
 * Key Features (and trade-offs):
 * - Typed CRUD/query helpers over Drizzle and database schema.
 * - Centralized data filtering, sorting, and pagination primitives.
 * - Keeps SQL/ORM concerns isolated from route and service layers.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use repositories from services only, not directly from routes.
 * 3. Keep repository methods deterministic and side-effect scoped.
 * 4. Run database-related tests when query behavior changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { providerConfigs } from "../db/schema";
import {
  decryptProviderApiKey,
  encryptProviderApiKey,
  isEncryptedProviderApiKey,
} from "../util/provider-key-crypto";
import { logger } from "../util/logger";

type ProviderConfigRow = typeof providerConfigs.$inferSelect;

export const ProviderConfigRepo = {
  async findById(id: string): Promise<ProviderConfigRow | null> {
    return await db.query.providerConfigs.findFirst({
      where: eq(providerConfigs.id, id),
    }) || null;
  },

  async findDefault(): Promise<ProviderConfigRow | null> {
    return await db.query.providerConfigs.findFirst({
      where: eq(providerConfigs.isDefault, true),
    }) || null;
  },

  async findFirst(): Promise<ProviderConfigRow | null> {
    return await db.query.providerConfigs.findFirst() || null;
  },

  async findByProvider(provider: string): Promise<ProviderConfigRow[]> {
    return db.query.providerConfigs.findMany({
      where: eq(providerConfigs.provider, provider),
    });
  },

  async list(): Promise<ProviderConfigRow[]> {
    return db.query.providerConfigs.findMany();
  },

  async maybeMigratePlaintextApiKey(row: ProviderConfigRow | null): Promise<ProviderConfigRow | null> {
    if (!row?.apiKey || isEncryptedProviderApiKey(row.apiKey)) return row;

    try {
      const encrypted = await encryptProviderApiKey(row.apiKey);
      if (!encrypted || encrypted === row.apiKey) return row;
      const [updated] = await db.update(providerConfigs)
        .set({ apiKey: encrypted })
        .where(eq(providerConfigs.id, row.id))
        .returning();
      return updated || { ...row, apiKey: encrypted };
    } catch (err) {
      logger.warn({
        scope: "provider-config.repo",
        message: "Failed to migrate legacy plaintext provider API key at rest",
        providerConfigId: row.id,
        err,
      });
      return row;
    }
  },

  async decryptApiKey(row: ProviderConfigRow | null): Promise<string | null> {
    const normalized = await this.maybeMigratePlaintextApiKey(row);
    return decryptProviderApiKey(normalized?.apiKey);
  },

  async findFirstForProvider(provider: string): Promise<ProviderConfigRow | null> {
    return await db.query.providerConfigs.findFirst({
      where: eq(providerConfigs.provider, provider),
    }) || null;
  },

  async findDefaultForProvider(provider: string): Promise<ProviderConfigRow | null> {
    return await db.query.providerConfigs.findFirst({
      where: and(eq(providerConfigs.provider, provider), eq(providerConfigs.isDefault, true)),
    }) || null;
  },
};
