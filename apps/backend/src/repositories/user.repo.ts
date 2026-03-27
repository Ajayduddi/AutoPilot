import { and, asc, eq, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '../db';
import {
  users,
  approvals,
  chatThreads,
  contextMemory,
  notifications,
  pushSubscriptions,
  userConnections,
  webhookSecrets,
  workflowRuns,
  workflows,
} from '../db/schema';

const LEGACY_USER_ID = 'usr_admin';

export const UserRepo = {
  LEGACY_USER_ID,

  async getById(id: string) {
    return db.query.users.findFirst({ where: eq(users.id, id) });
  },

  async getByEmail(email: string) {
    return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
  },

  async getByGoogleSub(googleSub: string) {
    return db.query.users.findFirst({ where: eq(users.googleSub, googleSub) });
  },

  async countRealUsers() {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(ne(users.id, LEGACY_USER_ID));
    return Number(row?.count || 0);
  },

  async getPrimaryRealUser() {
    return db.query.users.findFirst({
      where: ne(users.id, LEGACY_USER_ID),
      orderBy: asc(users.createdAt),
    });
  },

  async getAnyPrimaryUser() {
    const real = await this.getPrimaryRealUser();
    if (real) return real;
    return db.query.users.findFirst({ where: eq(users.id, LEGACY_USER_ID) });
  },

  async createUser(input: { email: string; name?: string | null; passwordHash?: string | null; googleSub?: string | null }) {
    const [created] = await db.insert(users).values({
      id: `usr_${randomUUID()}`,
      email: input.email.toLowerCase(),
      name: input.name || null,
      passwordHash: input.passwordHash || null,
      googleSub: input.googleSub || null,
    }).returning();
    return created;
  },

  async attachGoogleSub(userId: string, googleSub: string) {
    const [updated] = await db.update(users)
      .set({ googleSub })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },

  async normalizeLegacyEmailIfConflicts(email: string) {
    const legacy = await db.query.users.findFirst({ where: eq(users.id, LEGACY_USER_ID) });
    if (!legacy) return;
    if ((legacy.email || '').toLowerCase() !== email.toLowerCase()) return;
    await db.update(users)
      .set({ email: `legacy_${Date.now()}@autopilot.local` })
      .where(eq(users.id, LEGACY_USER_ID));
  },

  async reassignLegacyDataTo(newUserId: string) {
    await db.update(chatThreads).set({ userId: newUserId }).where(eq(chatThreads.userId, LEGACY_USER_ID));
    await db.update(workflowRuns).set({ userId: newUserId }).where(eq(workflowRuns.userId, LEGACY_USER_ID));
    await db.update(workflows).set({ ownerUserId: newUserId }).where(eq(workflows.ownerUserId, LEGACY_USER_ID));
    await db.update(notifications).set({ userId: newUserId }).where(eq(notifications.userId, LEGACY_USER_ID));
    await db.update(approvals).set({ userId: newUserId }).where(eq(approvals.userId, LEGACY_USER_ID));
    await db.update(userConnections).set({ userId: newUserId }).where(eq(userConnections.userId, LEGACY_USER_ID));
    await db.update(pushSubscriptions).set({ userId: newUserId }).where(eq(pushSubscriptions.userId, LEGACY_USER_ID));
    await db.update(webhookSecrets).set({ createdByUserId: newUserId }).where(eq(webhookSecrets.createdByUserId, LEGACY_USER_ID));
    await db.update(contextMemory).set({ userId: newUserId }).where(eq(contextMemory.userId, LEGACY_USER_ID));
  },

  async deleteLegacyUser() {
    await db.delete(users).where(eq(users.id, LEGACY_USER_ID));
  },

  async canUseAsSingleUser(userId: string) {
    const primary = await this.getPrimaryRealUser();
    return !primary || primary.id === userId;
  },

  async findExistingForGoogleLogin(email: string, googleSub: string) {
    return db.query.users.findFirst({
      where: and(
        ne(users.id, LEGACY_USER_ID),
        or(eq(users.googleSub, googleSub), eq(users.email, email.toLowerCase())),
      ),
    });
  },

  async isEmailTakenByAnotherUser(email: string, currentUserId: string) {
    const existing = await db.query.users.findFirst({
      where: and(
        eq(users.email, email.toLowerCase()),
        ne(users.id, currentUserId),
      ),
    });
    return Boolean(existing);
  },

  async updateProfile(userId: string, payload: { name: string }) {
    const [updated] = await db.update(users)
      .set({ name: payload.name.trim() || null })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },

  async updateEmail(userId: string, email: string) {
    const [updated] = await db.update(users)
      .set({ email: email.toLowerCase() })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },

  async updatePasswordHash(userId: string, passwordHash: string) {
    const [updated] = await db.update(users)
      .set({ passwordHash })
      .where(eq(users.id, userId))
      .returning();
    return updated;
  },
};
