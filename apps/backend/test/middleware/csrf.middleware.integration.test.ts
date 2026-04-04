import { describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { csrfMiddleware } from "../../src/middleware/csrf.middleware";

function makeReq(input?: Partial<Request>): Request {
  return {
    method: "POST",
    headers: {},
    auth: { user: { id: "usr_1" } as any },
    ...input,
  } as Request;
}

function makeRes() {
  const state = {
    statusCode: 200,
    payload: null as unknown,
    setCookies: [] as string[],
  };
  const res = {
    append: (name: string, value: string) => {
      if (name.toLowerCase() === "set-cookie") state.setCookies.push(value);
      return res;
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
  return { res, state };
}

describe("csrf middleware integration-ish behavior", () => {
  it("blocks authenticated mutation without csrf header", () => {
    const req = makeReq();
    const { res, state } = makeRes();
    let nextCalls = 0;
    const next: NextFunction = () => {
      nextCalls += 1;
    };

    csrfMiddleware(req, res, next);
    expect(nextCalls).toBe(0);
    expect(state.statusCode).toBe(403);
    expect(state.setCookies.length).toBeGreaterThan(0);
  });
});

