import { describe, expect, it } from "bun:test";
import {
  normalizeFrontendTelemetryEvent,
} from "../../../src/services/telemetry/frontend-telemetry.service";

describe("frontend telemetry service", () => {
  it("normalizes invalid level/category/message and bounds metadata", () => {
    const event = normalizeFrontendTelemetryEvent({
      level: "debug",
      category: "Stream Recovery / Retry",
      message: "",
      metadata: {
        retryCount: 2,
        ok: true,
        details: { nested: "value" },
        long: "x".repeat(800),
        list: [1, "two", { bad: true }, false],
        scope: "override-attempt",
      },
    });

    expect(event.level).toBe("info");
    expect(event.category).toBe("stream_recovery_retry");
    expect(event.message).toBe("stream_recovery_retry");
    expect(event.metadata).toEqual({
      retrycount: 2,
      ok: true,
      details: "[object]",
      long: "x".repeat(500),
      list: [1, "two", "[object]", false],
      scope: "override-attempt",
    });
  });

  it("falls back to safe defaults when payload is malformed", () => {
    const event = normalizeFrontendTelemetryEvent({
      level: null,
      category: null,
      message: null,
      metadata: "bad-payload",
    });

    expect(event).toEqual({
      level: "info",
      category: "client_event",
      message: "client_event",
      metadata: {},
    });
  });
});
