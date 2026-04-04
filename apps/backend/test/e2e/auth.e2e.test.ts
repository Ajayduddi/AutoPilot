import { afterEach, describe, expect, it } from "bun:test";
import { authRouter } from "../../src/routes/auth.routes";
import { buildApp, restoreMocks, withServer } from "./helpers/test-server";
import { UserRepo } from "../../src/repositories/user.repo";
import { AuthService } from "../../src/services/auth.service";

afterEach(() => {
  restoreMocks();
});

describe("Auth API Endpoints (/api/auth)", () => {
  it("POST /login - successful login returns 200 and set-cookie", async () => {
    const app = buildApp();
    app.use("/api/auth", authRouter);

    (UserRepo as any).getByEmail = async () => ({ id: "usr_1", email: "u@test.com", passwordHash: "hash:ok", name: "U" });
    (AuthService as any).verifyPassword = async () => true;
    (AuthService as any).createSessionForUser = async () => "session_token";

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@test.com", password: "password123" }),
      });
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.status).toBe("ok");
      expect(json.data.user.id).toBe("usr_1");
      
      const setCookie = res.headers.get("set-cookie");
      expect(Boolean(setCookie)).toBe(true);
      expect(setCookie).toContain("ap_session=session_token");
    } finally {
      await server.close();
    }
  });

  it("POST /login - invalid credentials returns 401", async () => {
    const app = buildApp();
    app.use("/api/auth", authRouter);

    (UserRepo as any).getByEmail = async () => ({ id: "usr_1", email: "u@test.com", passwordHash: "hash:ok", name: "U" });
    (AuthService as any).verifyPassword = async () => false; // Password mismatch

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@test.com", password: "wrong" }),
      });
      expect(res.status).toBe(401);
      const json = await res.json() as any;
      expect(json.error.code).toBe("UNAUTHORIZED");
    } finally {
      await server.close();
    }
  });

  it("POST /login - missing fields returns 400 validation error", async () => {
    const app = buildApp();
    app.use("/api/auth", authRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "u@test.com" }), // Missing password
      });
      expect(res.status).toBe(400); // Because zod validation fails in express router middleware
      const json = await res.json() as any;
      expect(json.error.code).toBe("VALIDATION_ERROR");
    } finally {
      await server.close();
    }
  });

  it("POST /logout - successful logout clears cookie", async () => {
    const app = buildApp();
    app.use("/api/auth", authRouter);

    (AuthService as any).logoutByCookie = async () => undefined;

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "cookie": "ap_session=valid_session",
        },
      });
      expect(res.status).toBe(200);
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("ap_session=;");
      expect(setCookie).toContain("Max-Age=0");
    } finally {
      await server.close();
    }
  });
  
  it("GET /me - returns 401 unauthenticated if no auth middleware", async () => {
    // Inject auth is false
    const app = buildApp({ injectAuth: false });
    app.use("/api/auth", authRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`);
      expect(res.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it("GET /me - returns user object if authenticated", async () => {
    // Inject auth adds req.auth
    const app = buildApp({ injectAuth: true });
    app.use("/api/auth", authRouter);

    const server = await withServer(app);
    try {
      const res = await fetch(`${server.baseUrl}/api/auth/me`);
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.data.user.id).toBe("usr_test");
    } finally {
      await server.close();
    }
  });
});
