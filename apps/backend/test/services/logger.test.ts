import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { logger } from "../../src/util/logger";

const originalNodeEnv = process.env.NODE_ENV;
const originalConsoleError = console.error;

let errorSpy: ReturnType<typeof mock>;

beforeEach(() => {
  process.env.NODE_ENV = "test";
  errorSpy = mock(() => {});
  console.error = errorSpy as unknown as typeof console.error;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  console.error = originalConsoleError;
});

describe("logger redaction", () => {
  it("redacts sensitive keys and bearer tokens", () => {
    logger.error({
      scope: "test",
      message: "Authorization: Bearer secret-token",
      apiKey: "super-secret-key",
      nested: {
        password: "hunter2",
      },
    });

    const [line, payload] = errorSpy.mock.calls[0] as [string, Record<string, unknown>?];
    const entry = payload ?? JSON.parse(line);
    expect(String(entry.scope)).toBe("test");
    expect(String(entry.message)).toContain("[REDACTED]");
    expect(entry.apiKey).toBe("[REDACTED]");
    expect((entry.nested as Record<string, unknown>).password).toBe("[REDACTED]");
  });
});
