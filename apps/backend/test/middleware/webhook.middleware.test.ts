/**
 * @fileoverview Unit tests for webhook middleware verification and rejection
 * behavior under malformed or missing signatures.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { WebhookSecretRepo } from "../../src/repositories/webhook-secret.repo";
import { requireWebhookSecret } from "../../src/middleware/webhook.middleware";

function mockReq(
  headers: Record<string, string> = {},
  overrides: Partial<Request> = {},
): Request {
  return {
    headers,
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" } as Request["socket"],
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const state = {
    statusCode: 200,
    payload: null as unknown,
  };
  const res = {
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

describe("requireWebhookSecret", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows valid env secret", async () => {
    process.env.WEBHOOK_CALLBACK_SECRET = "secret-123";
    process.env.NODE_ENV = "development";

    (WebhookSecretRepo.findActiveSecretByPlaintext as unknown as Function) = async () => null;
    (WebhookSecretRepo.hasActiveSecrets as unknown as Function) = async () => false;

    let nextCalls = 0;
    const next: NextFunction = () => {
      nextCalls += 1;
    };
    const { res } = mockRes();

    await requireWebhookSecret(mockReq({ "x-webhook-secret": "secret-123" }), res, next);
    expect(nextCalls).toBe(1);
  });

  it("fails closed in production when no secret configured", async () => {
    delete process.env.WEBHOOK_CALLBACK_SECRET;
    delete process.env.N8N_CALLBACK_SECRET;
    process.env.NODE_ENV = "production";

    (WebhookSecretRepo.hasActiveSecrets as unknown as Function) = async () => false;

    const { res, state } = mockRes();
    const next: NextFunction = () => undefined;
    await requireWebhookSecret(mockReq(), res, next);

    expect(state.statusCode).toBe(503);
    expect(state.payload).toBeTruthy();
  });

  it("rejects invalid provided secret", async () => {
    process.env.WEBHOOK_CALLBACK_SECRET = "expected-secret";
    process.env.NODE_ENV = "development";

    (WebhookSecretRepo.findActiveSecretByPlaintext as unknown as Function) = async () => null;
    (WebhookSecretRepo.hasActiveSecrets as unknown as Function) = async () => false;

    const { res, state } = mockRes();
    const next: NextFunction = () => undefined;
    await requireWebhookSecret(mockReq({ "x-webhook-secret": "wrong-secret" }), res, next);

    expect(state.statusCode).toBe(401);
  });

  it("allows loopback development fallback when no secret is configured", async () => {
    delete process.env.WEBHOOK_CALLBACK_SECRET;
    delete process.env.N8N_CALLBACK_SECRET;
    process.env.NODE_ENV = "development";

    (WebhookSecretRepo.hasActiveSecrets as unknown as Function) = async () => false;

    let nextCalls = 0;
    const next: NextFunction = () => {
      nextCalls += 1;
    };
    const { res } = mockRes();

    await requireWebhookSecret(mockReq(), res, next);
    expect(nextCalls).toBe(1);
  });

  it("rejects non-loopback development fallback when no secret is configured", async () => {
    delete process.env.WEBHOOK_CALLBACK_SECRET;
    delete process.env.N8N_CALLBACK_SECRET;
    process.env.NODE_ENV = "development";

    (WebhookSecretRepo.hasActiveSecrets as unknown as Function) = async () => false;

    const { res, state } = mockRes();
    const next: NextFunction = () => undefined;

    await requireWebhookSecret(
      mockReq({}, {
        ip: "203.0.113.10",
        socket: { remoteAddress: "203.0.113.10" } as Request["socket"],
      }),
      res,
      next,
    );

    expect(state.statusCode).toBe(503);
    expect(state.payload).toEqual({
      error: {
        message: "Webhook security is not configured. Configure webhook secrets before accepting non-local callbacks.",
        code: "SERVICE_UNAVAILABLE",
      },
    });
  });
});
