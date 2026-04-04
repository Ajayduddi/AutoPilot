import { describe, expect, it } from "bun:test";
import { buildNormalizedEmailDraft, splitEmbeddedEmailDrafts } from "./emailDraftParser";

describe("emailDraftParser", () => {
  it("keeps a single draft as one card payload", () => {
    const drafts = splitEmbeddedEmailDrafts({
      subject: "Hello",
      body: "Dear Team,\n\nThanks for the support.\n\nRegards,\nAjay",
    });
    expect(drafts.length).toBe(1);
    expect(drafts[0].subject).toBe("Hello");
  });

  it("splits repeated Subject sections into separate drafts", () => {
    const drafts = splitEmbeddedEmailDrafts({
      subject: "ignored",
      body: [
        "Subject: First Draft",
        "Dear A,",
        "",
        "Line one.",
        "",
        "Warm & Heartfelt",
        "",
        "Subject: Second Draft",
        "Dear B,",
        "",
        "Line two.",
      ].join("\n"),
    });
    expect(drafts.length).toBe(2);
    expect(drafts[0].subject).toBe("First Draft");
    expect(drafts[1].subject).toBe("Second Draft");
    expect(drafts[1].separatorBefore).toBe("Warm & Heartfelt");
  });

  it("strips helper CTA lines from normalized body and keeps them in outro", () => {
    const normalized = buildNormalizedEmailDraft({
      subject: "Subject A",
      body: [
        "Dear Team,",
        "",
        "Please find the update.",
        "",
        "Regards,",
        "Ajay",
        "",
        "Would you like me to shorten this version?",
      ].join("\n"),
    });
    expect(normalized.body).not.toContain("Would you like me");
    expect(normalized.outro).toContain("Would you like me");
  });

  it("preserves signature lines as stacked signature section", () => {
    const normalized = buildNormalizedEmailDraft({
      subject: "Sig test",
      body: [
        "Dear Manager,",
        "",
        "Thanks for your guidance.",
        "",
        "Best regards,",
        "Ajay Duddi",
        "ajayduddi.work@gmail.com",
        "+91 99999 99999",
      ].join("\n"),
    });
    const signature = normalized.sections.find((s) => s.kind === "signature");
    expect(signature?.kind).toBe("signature");
    if (signature?.kind === "signature") {
      expect(signature.lines.length).toBeGreaterThanOrEqual(2);
      expect(signature.lines.join("\n")).toContain("ajayduddi.work@gmail.com");
    }
  });

  it("does not over-strip normal greeting/body text", () => {
    const normalized = buildNormalizedEmailDraft({
      subject: "Body safety",
      body: [
        "Hello Team,",
        "",
        "Would you like to join the review meeting tomorrow?",
        "",
        "- Agenda item 1",
        "- Agenda item 2",
      ].join("\n"),
    });
    expect(normalized.body).toContain("Would you like to join the review meeting tomorrow?");
    expect(normalized.body).toContain("Agenda item 1");
  });
});
