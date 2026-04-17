import { describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
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
  it("sets a baseline content security policy", () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

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

    process.env.NODE_ENV = originalEnv;
  });
});
