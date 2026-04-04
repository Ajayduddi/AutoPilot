import { afterEach, describe, expect, it } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { WebhookSecretRepo } from "../../src/repositories/webhook-secret.repo";
import { requireWebhookSecret } from "../../src/middleware/webhook.middleware";

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
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
});
