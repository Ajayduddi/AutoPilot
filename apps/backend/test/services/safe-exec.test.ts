import { describe, expect, it } from "bun:test";
import { SafeExecError, safeExec } from "../../src/util/safe-exec";

describe("safeExec", () => {
  it("rejects commands outside the explicit allowlist", async () => {
    let thrown: unknown;
    try {
      await safeExec("echo", {
        args: ["hello"],
        allowedCommands: ["which"],
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SafeExecError);
    expect(String((thrown as Error).message || "")).toContain("Command not allowed");
  });
});
