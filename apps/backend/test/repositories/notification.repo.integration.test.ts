import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { NotificationRepo } from "../../src/repositories/notification.repo";
import { db } from "../../src/db";
import { notifications } from "../../src/db/schema";
import { assertDbReachable, cleanupTestUser, createTestUser, testId } from "./helpers/db-test-utils";

const usersToCleanup = new Set<string>();
let dbReady = false;
const dbRequired = process.env.REQUIRE_DB_TESTS === "true";

beforeAll(async () => {
  try {
    await assertDbReachable();
    dbReady = true;
  } catch (error) {
    dbReady = false;
    if (dbRequired) throw error;
    console.warn("[test:db] Skipping NotificationRepo DB integration tests (database unavailable).");
  }
});

afterEach(async () => {
  for (const userId of usersToCleanup) {
    await cleanupTestUser(userId);
  }
  usersToCleanup.clear();
});

describe("NotificationRepo DB integration", () => {
  it("creates notifications, returns sorted list, and supports before+limit pagination", async () => {
    if (!dbReady) return;

    const user = await createTestUser();
    usersToCleanup.add(user.id);

    const n1 = await NotificationRepo.createNotification(user.id, {
      type: "system",
      title: `First ${testId("n")}`,
      message: "oldest",
    });
    await Bun.sleep(5);
    const n2 = await NotificationRepo.createNotification(user.id, {
      type: "workflow_event",
      title: `Second ${testId("n")}`,
      message: "middle",
    });
    await Bun.sleep(5);
    const n3 = await NotificationRepo.createNotification(user.id, {
      type: "approval_request",
      title: `Third ${testId("n")}`,
      message: "newest",
    });

    const all = await NotificationRepo.getUserNotifications(user.id);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all[0].id).toBe(n3.id);
    expect(all[1].id).toBe(n2.id);
    expect(all[2].id).toBe(n1.id);

    const paged = await NotificationRepo.getUserNotifications(user.id, {
      before: n3.createdAt.toISOString(),
      limit: 1,
    });
    expect(paged.length).toBe(1);
    expect(paged[0].id).toBe(n2.id);
  });

  it("marks individual/all notifications as read and deletes all for user", async () => {
    if (!dbReady) return;

    const user = await createTestUser();
    usersToCleanup.add(user.id);

    const n1 = await NotificationRepo.createNotification(user.id, {
      type: "system",
      title: `ReadOne ${testId("n")}`,
    });
    const n2 = await NotificationRepo.createNotification(user.id, {
      type: "system",
      title: `ReadAll ${testId("n")}`,
    });

    const one = await NotificationRepo.markAsRead(n1.id, user.id);
    expect(one?.read).toBe(true);

    const allMarked = await NotificationRepo.markAllAsRead(user.id);
    expect(allMarked.length).toBeGreaterThanOrEqual(1);

    const rows = await db.query.notifications.findMany({
      where: eq(notifications.userId, user.id),
    });
    expect(rows.every((row) => row.read)).toBe(true);

    const deleted = await NotificationRepo.deleteAllForUser(user.id);
    expect(deleted).toBeGreaterThanOrEqual(2);
  });
});
