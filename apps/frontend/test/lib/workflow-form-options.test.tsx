import { describe, expect, it } from "bun:test";
import {
  authTypeOptions,
  httpMethodOptions,
  providerFilterOptions,
  providerLabels,
  providerOptions,
  triggerMethodOptions,
  visibilityOptions,
} from "../../src/lib/workflow-form-options";

describe("workflow-form-options", () => {
  it("exposes expected provider labels and provider options", () => {
    expect(providerLabels.n8n).toBe("n8n");
    expect(providerLabels.make).toBe("Make.com");
    expect(providerLabels.custom).toBe("Custom");

    const providerValues = providerOptions.map((option) => option.value);
    expect(providerValues).toEqual(["n8n", "zapier", "make", "sim", "custom"]);
    expect(providerOptions.every((option) => typeof option.icon === "function")).toBeTrue();
  });

  it("keeps auth/trigger/http method options in sync with UI expectations", () => {
    expect(authTypeOptions.map((option) => option.value)).toEqual([
      "none",
      "bearer",
      "api_key",
      "header_secret",
      "custom",
    ]);
    expect(triggerMethodOptions.map((option) => option.value)).toEqual(["webhook", "api", "internal"]);
    expect(httpMethodOptions.map((option) => option.value)).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    expect(visibilityOptions.map((option) => option.value)).toEqual(["public", "private"]);
  });

  it("includes all-provider filter entry followed by concrete providers", () => {
    expect(providerFilterOptions[0]).toEqual({ value: "", label: "All Providers" });
    expect(providerFilterOptions.slice(1).map((option) => option.value)).toEqual([
      "n8n",
      "zapier",
      "make",
      "sim",
      "custom",
    ]);
  });
});
