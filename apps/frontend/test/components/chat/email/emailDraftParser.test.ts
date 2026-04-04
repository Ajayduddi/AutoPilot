import { describe, expect, it } from "bun:test";
import {
  buildNormalizedEmailDraft,
  normalizeEmailText,
  splitEmbeddedEmailDrafts,
} from "../../../../src/components/chat/email/emailDraftParser";

describe("emailDraftParser", () => {
  it("normalizes CRLF and non-breaking spaces", () => {
    const normalized = normalizeEmailText("Hello\r\nWorld\u00a0!");
    expect(normalized).toBe("Hello\nWorld !");
  });

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

  it("moves trailing variant separator to final outro when no next subject exists", () => {
    const drafts = splitEmbeddedEmailDrafts({
      subject: "ignored",
      body: [
        "Subject: Draft One",
        "Dear A,",
        "",
        "Line one.",
        "",
        "Subject: Draft Two",
        "Dear B,",
        "",
        "Line two.",
        "",
        "Warm & Heartfelt",
      ].join("\n"),
      outro: "Final note.",
    });
    expect(drafts.length).toBe(2);
    expect(drafts[1]?.outro).toContain("Warm & Heartfelt");
    expect(drafts[1]?.outro).toContain("Final note.");
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

  it("merges fallback signature detection with explicit signature payload without duplication", () => {
    const normalized = buildNormalizedEmailDraft({
      subject: "Sig merge",
      body: [
        "Dear Manager,",
        "",
        "Thank you.",
        "",
        "Regards,",
        "Ajay Duddi",
        "ajayduddi.work@gmail.com",
      ].join("\n"),
      signature: ["Ajay Duddi", "ajayduddi.work@gmail.com", "+91 99999 99999"],
    });

    const signature = normalized.sections.find((section) => section.kind === "signature");
    expect(signature?.kind).toBe("signature");
    if (signature?.kind === "signature") {
      expect(signature.lines.filter((line) => line === "Ajay Duddi").length).toBe(1);
      expect(signature.lines.join("\n")).toContain("+91 99999 99999");
    }
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
