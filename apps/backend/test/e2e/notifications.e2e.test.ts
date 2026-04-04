import { afterEach, describe, expect, it } from "bun:test";
import { notificationsRouter } from "../../src/routes/notifications.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { NotificationRepo } from "../../src/repositories/notification.repo";

afterEach(() => {
  restoreMocks();
});

describe("Notifications API Endpoints (/api/notifications)", () => {
  it("GET / - returns a list of notifications", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/notifications", notificationsRouter);

    (NotificationRepo as any).getUserNotifications = async () => [
      { id: "notif_1", type: "workflow_completed", read: false, createdAt: new Date() }
    ];

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/notifications`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data[0].id).toBe("notif_1");
    } finally {
      await server.close();
    }
  });

  it("POST /api/notifications/:id/read - marks a notification as read", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/notifications", notificationsRouter);

    let calledWithId = "";
    (NotificationRepo as any).markAsRead = async (id: string, userId: string) => {
      calledWithId = id;
      return { id, read: true };
    };

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/notifications/notif_1/read`, {
        method: "POST"
      });
      expect(res.status).toBe(200);
      expect(calledWithId).toBe("notif_1");
    } finally {
      await server.close();
    }
  });

  it("POST /api/notifications/read-all - marks all notifications as read", async () => {
    const app = buildApp({ injectAuth: true });
    app.use("/api/notifications", notificationsRouter);

    let called = false;
    (NotificationRepo as any).markAllAsRead = async () => {
      called = true;
      return [{ id: "notif_1" }];
    };

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/notifications/read-all`, {
        method: "POST"
      });
      expect(res.status).toBe(200);
      expect(called).toBe(true);
    } finally {
      await server.close();
    }
  });
});
