import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { resetRuntimeConfigCache } from "../../src/config/runtime.config";
import { securityHeadersMiddleware } from "../../src/middleware/security-headers.middleware";

function mockRes() {
  const headers = new Map<string, string>();
  return {
    headers,
    res: {
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
    } as unknown as Response,
  };
}

describe("securityHeadersMiddleware", () => {
  const envKeys = ["NODE_ENV", "AUTOPILOT_HOME"];
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key];
  });

  afterEach(() => {
    // Always restore — runs even when the test body throws.
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    resetRuntimeConfigCache();
  });

  it("sets a baseline content security policy", async () => {
    // Write a temp config.json with production-safe URLs so getRuntimeConfig()
    // passes production validation when NODE_ENV=production.
    const home = `/tmp/autopilot-security-headers-test-${crypto.randomUUID()}`;
    Bun.spawnSync({ cmd: ["mkdir", "-p", home] });
    await Bun.write(
      `${home}/config.json`,
      JSON.stringify({
        OLLAMA_URL: "https://ollama.example.com",
        CALLBACK_BASE_URL: "https://api.example.com",
        FRONTEND_ORIGIN: "https://app.example.com",
      }),
    );
    process.env.AUTOPILOT_HOME = home;
    process.env.NODE_ENV = "production";
    resetRuntimeConfigCache();

    const { res, headers } = mockRes();
    let nextCalls = 0;
    const next: NextFunction = () => {
      nextCalls += 1;
    };

    securityHeadersMiddleware({} as Request, res, next);

    expect(nextCalls).toBe(1);
    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("connect-src 'self'");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains; preload");
  });
});
