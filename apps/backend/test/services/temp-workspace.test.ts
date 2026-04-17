import { describe, expect, it } from "bun:test";
import { createTempWorkspace } from "../../src/util/temp-workspace";

describe("temp-workspace", () => {
  it("creates, lists, and cleans up temp files", async () => {
    const workspace = await createTempWorkspace("autopilot-test");
    const filePath = await workspace.createFile("resume.md", new TextEncoder().encode("hello world"));

    const entries = await workspace.listEntries();
    expect(filePath).toContain(workspace.root);
    expect(entries.length).toBe(1);
    expect(entries[0]).toContain("resume.md");

    await workspace.cleanup();

    expect(await Bun.file(filePath).exists()).toBe(false);
  });
});
