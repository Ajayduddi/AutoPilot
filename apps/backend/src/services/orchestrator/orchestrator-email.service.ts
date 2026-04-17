/**
 * @fileoverview apps/backend/src/services/orchestrator/orchestrator-email.service.ts
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
type StreamBlock = { type: string; [key: string]: any };

type ParsedEmailDraft = {
  label?: string;
  intro?: string;
  subject: string;
  body: string;
  outro?: string;
};

type ParsedEmailEnvelope = {
  intro?: string;
  drafts: Array<{ label?: string; subject: string; bodyMarkdown: string }>;
  outro?: string;
};

export type EmailDraftBlockBuild = {
  blocks: StreamBlock[] | null;
  emailJsonParseOk: boolean;
  emailDraftCount: number;
  emailFallbackUsed: boolean;
};

function parseSingleEmailDraft(text: string): ParsedEmailDraft | null {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const subjectMatch = raw.match(/(?:^|\n)\s*\**subject\**\s*:\s*(.+)/i);
  if (!subjectMatch || !subjectMatch[1]?.trim()) return null;

  const subjectLine = subjectMatch[0];
  const subjectIndex = raw.indexOf(subjectLine);
  if (subjectIndex < 0) return null;

  const intro = raw.slice(0, subjectIndex).trim();
  const afterSubject = raw.slice(subjectIndex + subjectLine.length).trim();
  if (!afterSubject) return null;

  const outroMatch = afterSubject.match(
    /(?:\n{2,}|\n)\s*(?:[*_`>-]+\s*)?(want me to|would you like|if you'd like|if you want,|let me know if you'd like|just let me know|i can also|i can\b|i could\b|tips?:|feel free to)/i,
  );

  const body = (outroMatch ? afterSubject.slice(0, outroMatch.index ?? 0) : afterSubject).trim();
  const outro = (outroMatch ? afterSubject.slice(outroMatch.index ?? 0) : '').trim();
  if (!body) return null;

  const bodyLines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const hasGreeting = bodyLines.some((line) => /^(dear|hi|hello|respected)\b/i.test(line));
  if (!hasGreeting && bodyLines.length < 3) return null;

  return {
    intro: intro || undefined,
    subject: subjectMatch[1].trim().replace(/^\**|\**$/g, ''),
    body,
    outro: outro || undefined,
  };
}

function safeJsonParseFromText<T>(text: string): T | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || raw;
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  const input = jsonMatch ? jsonMatch[0] : candidate;
  try {
    return JSON.parse(input) as T;
  } catch {
    return null;
  }
}

function parseEmailEnvelope(text: string): ParsedEmailEnvelope | null {
  const parsed = safeJsonParseFromText<ParsedEmailEnvelope>(text);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Array.isArray(parsed.drafts) || parsed.drafts.length === 0) return null;
  const drafts = parsed.drafts
    .map((draft) => ({
      label: typeof draft?.label === 'string' ? draft.label.trim() : undefined,
      subject: typeof draft?.subject === 'string' ? draft.subject.trim() : '',
      bodyMarkdown: typeof draft?.bodyMarkdown === 'string' ? draft.bodyMarkdown.trim() : '',
    }))
    .filter((draft) => draft.subject && draft.bodyMarkdown);
  if (!drafts.length) return null;
  return {
    intro: typeof parsed.intro === 'string' ? parsed.intro.trim() || undefined : undefined,
    drafts,
    outro: typeof parsed.outro === 'string' ? parsed.outro.trim() || undefined : undefined,
  };
}

const EMAIL_SUBJECT_GLOBAL_PATTERN = /(?:^|\n)\s*\**subject\**\s*:\s*.+/gi;
const EMAIL_VARIANT_KEYWORDS_PATTERN = /\b(professional|friendly|formal|informal|casual|official|colleague|client|boss|elegant|fun|option|version|draft)\b/i;

function normalizeVariantHeading(line: string): string {
  return String(line || '')
    .trim()
    .replace(/[*_`#>~\-]/g, ' ')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isVariantHeaderLine(line: string): boolean {
  const normalized = normalizeVariantHeading(line);
  if (!normalized) return false;
  if (normalized.length > 90) return false;
  if (/\bsubject\s*:/.test(normalized)) return false;
  if (/^(dear|hi|hello|respected)\b/.test(normalized)) return false;
  if (/^(best regards|warm regards|kind regards|regards|sincerely|with gratitude|thank you|yours)/.test(normalized)) return false;
  if (!EMAIL_VARIANT_KEYWORDS_PATTERN.test(normalized)) return false;
  if (/[.!?]$/.test(normalized)) return false;
  return true;
}

function stripTrailingVariantHeader(segment: string): string {
  const lines = String(segment || '').split('\n');
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end -= 1;
  if (end < 0) return '';

  let start = end;
  while (start >= 0 && lines[start].trim()) start -= 1;
  const tail = lines.slice(start + 1, end + 1).map((line) => line.trim()).filter(Boolean);
  const isVariantTail = tail.length > 0 && tail.length <= 2 && tail.every((line) => isVariantHeaderLine(line));
  if (!isVariantTail) return segment.trim();
  return lines.slice(0, start + 1).join('\n').trim();
}

function splitEmailCandidates(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  const subjectStarts: number[] = [];
  for (const match of text.matchAll(EMAIL_SUBJECT_GLOBAL_PATTERN)) {
    if (typeof match.index === 'number') subjectStarts.push(match.index);
  }
  if (subjectStarts.length <= 1) return [text];

  const segments: string[] = [];
  for (let i = 0; i < subjectStarts.length; i += 1) {
    const start = subjectStarts[i];
    const end = i + 1 < subjectStarts.length ? subjectStarts[i + 1] : text.length;
    const segment = stripTrailingVariantHeader(text.slice(start, end));
    if (segment) segments.push(segment);
  }
  return segments.length ? segments : [text];
}

function parseEmailDrafts(text: string): ParsedEmailDraft[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const candidates = splitEmailCandidates(raw);
  const parsed: ParsedEmailDraft[] = [];
  for (const candidate of candidates) {
    const draft = parseSingleEmailDraft(candidate);
    if (draft) parsed.push(draft);
  }
  if (parsed.length > 0) return parsed;
  const fallback = parseSingleEmailDraft(raw);
  return fallback ? [fallback] : [];
}

export function buildEmailDraftBlocks(reply: string): EmailDraftBlockBuild {
  const envelope = parseEmailEnvelope(reply);
  if (envelope) {
    const blocks: StreamBlock[] = [];
    envelope.drafts.forEach((draft, index) => {
      if (index === 0 && envelope.intro) {
        blocks.push({ type: 'markdown', text: envelope.intro });
      }
      blocks.push({ type: 'email_draft', subject: draft.subject, body: draft.bodyMarkdown, ...(draft.label ? { label: draft.label } : {}) });
      if (index === envelope.drafts.length - 1 && envelope.outro) {
        blocks.push({ type: 'markdown', text: envelope.outro });
      }
    });
    return {
      blocks,
      emailJsonParseOk: true,
      emailDraftCount: envelope.drafts.length,
      emailFallbackUsed: false,
    };
  }

  const drafts = parseEmailDrafts(reply);
  if (!drafts.length) {
    return {
      blocks: null,
      emailJsonParseOk: false,
      emailDraftCount: 0,
      emailFallbackUsed: false,
    };
  }

  const blocks: StreamBlock[] = [];
  drafts.forEach((draft, index) => {
    if (draft.intro) {
      blocks.push({ type: 'markdown', text: draft.intro });
    }
    blocks.push({ type: 'email_draft', subject: draft.subject, body: draft.body });
    if (draft.outro && index === drafts.length - 1) {
      blocks.push({ type: 'markdown', text: draft.outro });
    }
  });
  return {
    blocks,
    emailJsonParseOk: false,
    emailDraftCount: drafts.length,
    emailFallbackUsed: true,
  };
}

const EMAIL_MODE_PATTERNS = [
  /\b(draft|write|compose|generate|create)\s+(an?\s+)?(email|mail)\b/i,
  /\b(email|mail)\s+(draft|template|version|subject|body)\b/i,
  /\bsubject\s*[:\-]/i,
  /\b(resignation|birthday|apology|follow[-\s]?up|request|application)\s+email\b/i,
];

export function shouldUseEmailDraftMode(message: string): boolean {
  const text = String(message || '').trim();
  if (!text) return false;
  return EMAIL_MODE_PATTERNS.some((pattern) => pattern.test(text));
}
