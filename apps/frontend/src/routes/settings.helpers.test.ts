import { describe, expect, it } from "bun:test";
import { firstParam, mapLegacyTab, normalizeSection } from "./settings.helpers";

describe("settings.helpers", () => {
  it("maps legacy tab values", () => {
    expect(mapLegacyTab("account")).toBe("account");
    expect(mapLegacyTab("connections")).toBe("connections");
    expect(mapLegacyTab("webhooks")).toBe("webhooks");
    expect(mapLegacyTab("unknown")).toBeNull();
  });

  it("normalizes unknown sections to connections", () => {
    expect(normalizeSection("account")).toBe("account");
    expect(normalizeSection("webhooks")).toBe("webhooks");
    expect(normalizeSection("connections")).toBe("connections");
    expect(normalizeSection("bad-value")).toBe("connections");
    expect(normalizeSection(undefined)).toBe("connections");
  });

  it("extracts first param value safely", () => {
    expect(firstParam("a")).toBe("a");
    expect(firstParam(["a", "b"])).toBe("a");
    expect(firstParam(undefined)).toBeUndefined();
  });
});
