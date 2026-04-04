import { describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "../../src/middleware/rate-limit.middleware";

function makeReq(ip = "127.0.0.1"): Request {
  return {
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function makeRes() {
  const state = {
    statusCode: 200,
    payload: null as unknown,
    headers: {} as Record<string, string>,
  };
  const res = {
    setHeader: (k: string, v: string) => {
      state.headers[k] = v;
    },
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (data: unknown) => {
      state.payload = data;
      return res;
    },
  } as unknown as Response;
  return { state, res };
}

describe("rateLimit middleware", () => {
  it("allows requests under limit and blocks over limit", () => {
    const middleware = rateLimit({ keyPrefix: "test", limit: 2, windowMs: 60_000 });
    const req = makeReq("10.0.0.1");
    const { state, res } = makeRes();
    let nextCalls = 0;
    const next: NextFunction = () => {
      nextCalls += 1;
    };

    middleware(req, res, next);
    middleware(req, res, next);
    middleware(req, res, next);

    expect(nextCalls).toBe(2);
    expect(state.statusCode).toBe(429);
    expect(state.headers["Retry-After"]).toBeDefined();
    expect(state.payload).toBeTruthy();
  });
});
