/**
  * email section type alias.
  */
type EmailSection =
  | { kind: "salutation" | "paragraph" | "list" | "signoff"; markdown: string }
  | { kind: "signature"; lines: string[] };

/**
 * Interface describing email draft payload shape.
 */
export interface EmailDraftPayload {
  subject: string;
  body: string;
  intro?: string;
  outro?: string;
  signature?: string[];
  separatorBefore?: string;
}

/**
 * Interface describing normalized email draft shape.
 */
export interface NormalizedEmailDraft {
  subject: string;
  body: string;
  outro: string;
  sections: EmailSection[];
  sendBody: string;
  copyPayload: string;
}
const EMAIL_HELPER_PROMPT_PATTERNS = [
  /^want me to\b/i,
  /^would you like\b/i,
  /^i can\b/i,
  /^i could\b/i,
  /^if you'd like\b/i,
  /^if you want\b/i,
  /^let me know if you'd like\b/i,
  /^just let me know\b/i,
  /^feel free to\b/i,
  /^tips?\b/i,
];
const EMAIL_SALUTATION_PATTERN = /^(dear|hi|hello|respected)\b/i;
const EMAIL_SIGNOFF_PATTERN = /^(best regards|warm regards|kind regards|regards|sincerely|with gratitude|thanks(?: and regards)?|yours faithfully|yours truly|thank you)\b/i;
const EMAIL_LIST_PATTERN = /^(\s*[-*•]\s+|\s*\d+\.\s+)/;
const EMAIL_HELPER_SEPARATOR_PATTERN = /^\s*[-*_]{3,}\s*$/;
const EMAIL_SIGNATURE_LINE_PATTERN = /(^\[[^\]]+\]$)|(^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$)|(^https?:\/\/\S+$)|(^\+?\d[\d\s\-()]{7,}$)|(^(?:phone|email|website|address|mobile|contact|case|date)\s*[:\-])/i;
const EMAIL_SUBJECT_MATCH_ALL_PATTERN = /(?:^|\n)\s*\**subject\**\s*:\s*(.+)/gi;

/**
 * Normalizes raw email text for downstream parsing.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param raw - Input value for normalizeEmailText.
 * @returns Return value from normalizeEmailText.
 *
 * @example
 * ```typescript
 * const output = normalizeEmailText(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function normalizeEmailText(raw: string): string {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "");
}

/**
 * Collapses repeated blank lines while preserving logical spacing.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param lines - Input value for compactBlankLines.
 * @returns Return value from compactBlankLines.
 *
 * @example
 * ```typescript
 * const output = compactBlankLines(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function compactBlankLines(lines: string[]): string[] {
  const compact: string[] = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = !line.trim();
    if (isBlank) {
      if (!previousBlank) compact.push("");
      previousBlank = true;
      continue;
    }
    compact.push(line);
    previousBlank = false;
  }
  while (compact.length && !compact[0].trim()) compact.shift();
  while (compact.length && !compact[compact.length - 1].trim()) compact.pop();
  return compact;
}

/**
 * Sanitizes a line before checking helper-prompt patterns.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param line - Input value for sanitizeLineForPromptCheck.
 * @returns Return value from sanitizeLineForPromptCheck.
 *
 * @example
 * ```typescript
 * const output = sanitizeLineForPromptCheck(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function sanitizeLineForPromptCheck(line: string): string {
  return line.trim().replace(/^[>*\s`#\-_]+/, "").replace(/\*+/g, "");
}

/**
 * Normalizes a candidate variant heading for robust matching.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param line - Input value for normalizeVariantHeading.
 * @returns Return value from normalizeVariantHeading.
 *
 * @example
 * ```typescript
 * const output = normalizeVariantHeading(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function normalizeVariantHeading(line: string): string {
  return String(line || "")
    .trim()
    .replace(/[*_`#>~\-]/g, " ")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Removes markdown-like decorator characters from a variant heading line.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param line - Input value for stripVariantDecorators.
 * @returns Return value from stripVariantDecorators.
 *
 * @example
 * ```typescript
 * const output = stripVariantDecorators(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function stripVariantDecorators(line: string): string {
  return String(line || "")
    .trim()
    .replace(/^[>\s`*_#~\-]+/, "")
    .replace(/[*_`#~]+/g, "")
    .trim();
}

/**
 * Computes the title-case ratio used by variant-heading heuristics.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param line - Input value for titleCaseRatio.
 * @returns Return value from titleCaseRatio.
 *
 * @example
 * ```typescript
 * const output = titleCaseRatio(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function titleCaseRatio(line: string): number {
  const words = line.split(/\s+/).filter((word) => /[a-zA-Z]/.test(word));
  if (!words.length) return 0;
  const titleLike = words.filter((word) => /^[A-Z][a-z]+$/.test(word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, ""))).length;
  return titleLike / words.length;
}

/**
 * Detects whether a line likely represents a variant header.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param line - Input value for isLikelyVariantHeaderLine.
 * @returns Return value from isLikelyVariantHeaderLine.
 *
 * @example
 * ```typescript
 * const output = isLikelyVariantHeaderLine(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function isLikelyVariantHeaderLine(line: string): boolean {
  const raw = stripVariantDecorators(line);
  const normalized = normalizeVariantHeading(raw);
  if (!normalized) return false;
  if (normalized.length > 72) return false;
  if (EMAIL_LIST_PATTERN.test(line)) return false;
  if (/\bsubject\s*:/.test(normalized)) return false;
  if (EMAIL_SALUTATION_PATTERN.test(normalized)) return false;
  if (EMAIL_SIGNOFF_PATTERN.test(normalized)) return false;
  if (EMAIL_SIGNATURE_LINE_PATTERN.test(raw)) return false;
  if (/[.!?:]$/.test(raw)) return false;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  if (tokenCount === 0 || tokenCount > 7) return false;
  let score = 0;
  if (tokenCount <= 5) score += 2;
  if (normalized.length <= 40) score += 2;
  if (/[&/|]/.test(raw)) score += 1;
  if (/^[^A-Za-z0-9]/.test(String(line || "").trim())) score += 1;
  if (titleCaseRatio(raw) >= 0.5) score += 2;
  if (!/[.!?]/.test(raw)) score += 1;
  if (/[A-Za-z]/.test(raw) && !/\b(i|you|we|they|he|she|it)\b/i.test(raw)) score += 1;

  return score >= 5;
}

/**
 * Parses raw email draft payload input into structured subject and body fields.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param input - Input value for parseEmailDraftPayload.
 * @returns Return value from parseEmailDraftPayload.
 *
 * @example
 * ```typescript
 * const output = parseEmailDraftPayload(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function parseEmailDraftPayload(input: Partial<EmailDraftPayload>): EmailDraftPayload {
  const subject = String(input.subject || "").trim();
  const body = normalizeEmailText(String(input.body || ""));
  const intro = input.intro ? normalizeEmailText(String(input.intro)).trim() : undefined;
  const outro = input.outro ? normalizeEmailText(String(input.outro)).trim() : undefined;
  const separatorBefore = input.separatorBefore ? normalizeEmailText(String(input.separatorBefore)).trim() : undefined;
  const signature = Array.isArray(input.signature)
    ? input.signature.map((line) => normalizeEmailText(String(line)).trim()).filter(Boolean)
    : undefined;
  return { subject, body, intro, outro, signature, separatorBefore };
}

/**
 * Extracts a trailing variant header from parsed email draft lines.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param lines - Input value for extractTrailingVariantHeader.
 * @returns Return value from extractTrailingVariantHeader.
 *
 * @example
 * ```typescript
 * const output = extractTrailingVariantHeader(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function extractTrailingVariantHeader(lines: string[]): { bodyLines: string[]; separator?: string } {
  const clone = [...lines];
  let end = clone.length - 1;
  while (end >= 0 && !clone[end].trim()) end -= 1;
  if (end < 0) return { bodyLines: clone };
  let start = end;
  while (start >= 0 && clone[start].trim()) start -= 1;
  const tail = clone.slice(start + 1, end + 1).map((line) => line.trim()).filter(Boolean);
  const isVariantTail = tail.length > 0 && tail.length <= 2 && tail.every((line) => isLikelyVariantHeaderLine(line));
  if (!isVariantTail) return { bodyLines: clone };

  return {
    bodyLines: clone.slice(0, start + 1),
    separator: tail.join(" ").trim() || undefined,
  };
}

/**
 * Splits normalized email text into body and outro segments.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param raw - Input value for splitEmailBodyAndOutro.
 * @returns Return value from splitEmailBodyAndOutro.
 *
 * @example
 * ```typescript
 * const output = splitEmailBodyAndOutro(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function splitEmailBodyAndOutro(raw: string): { body: string; outro: string } {
  const lines = normalizeEmailText(raw)
    .split("\n")
    .filter((line) => !EMAIL_HELPER_SEPARATOR_PATTERN.test(line));
  const helperPromptIndex = lines.findIndex((line, idx) => {
    const sanitized = sanitizeLineForPromptCheck(line);
    const isHelper = EMAIL_HELPER_PROMPT_PATTERNS.some((pattern) => pattern.test(sanitized));
    if (!isHelper) return false;
    const priorNonEmpty = lines.slice(0, idx).map((item) => item.trim()).filter(Boolean);
    const hasSignoffBefore = priorNonEmpty.some((item) => EMAIL_SIGNOFF_PATTERN.test(item));
    return hasSignoffBefore;
  });
  const kept = (helperPromptIndex >= 0 ? lines.slice(0, helperPromptIndex) : lines).slice();
  const tail = helperPromptIndex >= 0 ? lines.slice(helperPromptIndex) : [];
  const extracted = extractTrailingVariantHeader(kept);
  const compactKept = compactBlankLines(extracted.bodyLines);
  const tailWithSeparator = [...(extracted.separator ? [extracted.separator] : []), ...tail];
  const compactTail = compactBlankLines(tailWithSeparator);

  return {
    body: compactKept.join("\n").trim(),
    outro: compactTail.join("\n").trim(),
  };
}

/**
 * Parses cleaned email body text into structured sections.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param cleanedBody - Input value for parseEmailSections.
 * @returns Return value from parseEmailSections.
 *
 * @example
 * ```typescript
 * const output = parseEmailSections(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function parseEmailSections(cleanedBody: string): EmailSection[] {
  const blocks = cleanedBody
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (!blocks.length) return [];
  const sections: EmailSection[] = [];
  const normalizedBlocks = [...blocks];
  let cursor = 0;

  if (EMAIL_SALUTATION_PATTERN.test(normalizedBlocks[0])) {
    const salutationLines = normalizedBlocks[0].split("\n").map((line) => line.trim()).filter(Boolean);
    if (salutationLines.length > 0) {
      sections.push({ kind: "salutation", markdown: salutationLines[0] });
      if (salutationLines.length > 1) {
        normalizedBlocks.splice(1, 0, salutationLines.slice(1).join("\n"));
      }
    }
    cursor = 1;
  }
  let signoffIndex = -1;
  for (let i = cursor; i < normalizedBlocks.length; i += 1) {
    if (EMAIL_SIGNOFF_PATTERN.test(normalizedBlocks[i])) {
      signoffIndex = i;
      break;
    }
  }
  const bodyEnd = signoffIndex >= 0 ? signoffIndex : normalizedBlocks.length;
  for (let i = cursor; i < bodyEnd; i += 1) {
    const block = normalizedBlocks[i];
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const isList = lines.length > 0 && lines.every((line) => EMAIL_LIST_PATTERN.test(line));
    sections.push({
      kind: isList ? "list" : "paragraph",
      markdown: isList ? lines.join("\n") : lines.join("\n\n"),
    });
  }

  if (signoffIndex >= 0) {
    const signoffLines = normalizedBlocks[signoffIndex].split("\n").map((line) => line.trim()).filter(Boolean);
    if (signoffLines.length > 0) {
      sections.push({ kind: "signoff", markdown: signoffLines[0] });
    }
    const signatureLines = [
      ...signoffLines.slice(1),
      ...normalizedBlocks.slice(signoffIndex + 1).flatMap((block) => block.split("\n")),
    ]
      .map((line) => line.trim())
      .filter(Boolean);
    if (signatureLines.length) {
      sections.push({ kind: "signature", lines: signatureLines });
    }
  }

  return sections;
}

/**
 * Prepends intro content into the parsed section list when present.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param sections - Input value for appendIntroToSections.
 * @param intro - Input value for appendIntroToSections.
 * @returns Return value from appendIntroToSections.
 *
 * @example
 * ```typescript
 * const output = appendIntroToSections(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function appendIntroToSections(sections: EmailSection[], intro?: string): EmailSection[] {
  const normalizedIntro = normalizeEmailText(intro || "").trim();
  if (!normalizedIntro) return sections;
  return [{ kind: "paragraph", markdown: normalizedIntro }, ...sections];
}

/**
 * Appends signature lines into the parsed section list when present.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param sections - Input value for appendSignatureToSections.
 * @param signature - Input value for appendSignatureToSections.
 * @returns Return value from appendSignatureToSections.
 *
 * @example
 * ```typescript
 * const output = appendSignatureToSections(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function appendSignatureToSections(sections: EmailSection[], signature?: string[]): EmailSection[] {
  if (!Array.isArray(signature) || !signature.length) return sections;
  const normalized = signature.map((line) => line.trim()).filter(Boolean);
  if (!normalized.length) return sections;
  const existingSignatureIndex = sections.findIndex((section) => section.kind === "signature");
  if (existingSignatureIndex >= 0) {
    const existing = sections[existingSignatureIndex] as Extract<EmailSection, { kind: "signature" }>;
    const merged = [...existing.lines];
    for (const line of normalized) {
      if (!merged.includes(line)) merged.push(line);
    }
    const next = [...sections];
    next[existingSignatureIndex] = { kind: "signature", lines: merged };
    return next;
  }
  return [...sections, { kind: "signature", lines: normalized }];
}

/**
 * Uses fallback rules to split email body from signature text.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param body - Input value for splitBodyAndSignatureFallback.
 * @returns Return value from splitBodyAndSignatureFallback.
 *
 * @example
 * ```typescript
 * const output = splitBodyAndSignatureFallback(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function splitBodyAndSignatureFallback(body: string): { body: string; signatureLines: string[] } {
  const lines = body.split("\n");
  const signatureLines: string[] = [];
  let signatureStart = -1;

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (signatureStart >= 0) signatureStart = i;
      continue;
    }
    if (EMAIL_SIGNATURE_LINE_PATTERN.test(trimmed)) {
      signatureStart = i;
      signatureLines.unshift(trimmed);
      continue;
    }
    break;
  }

  if (signatureStart < 0 || signatureLines.length < 2) {
    return { body, signatureLines: [] };
  }
  const bodyLines = compactBlankLines(lines.slice(0, signatureStart));
  return { body: bodyLines.join("\n"), signatureLines };
}

/**
 * Builds a normalized email draft model for rendering and copy flows.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param input - Input value for buildNormalizedEmailDraft.
 * @returns Return value from buildNormalizedEmailDraft.
 *
 * @example
 * ```typescript
 * const output = buildNormalizedEmailDraft(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function buildNormalizedEmailDraft(input: Partial<EmailDraftPayload>): NormalizedEmailDraft {
  const payload = parseEmailDraftPayload(input);
  const split = splitEmailBodyAndOutro(payload.body);
  const fallback = splitBodyAndSignatureFallback(split.body);
  let sections = parseEmailSections(fallback.body);
  sections = appendSignatureToSections(sections, fallback.signatureLines);

  sections = appendIntroToSections(sections, payload.intro);
  sections = appendSignatureToSections(sections, payload.signature);

  if (!sections.length && split.body.trim()) {
    sections = [{ kind: "paragraph", markdown: split.body.trim() }];
  }
  const body = sections
    .map((section) => (section.kind === "signature" ? section.lines.join("\n") : section.markdown))
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const outroSegments = [split.outro, payload.outro].map((segment) => normalizeEmailText(segment || "").trim()).filter(Boolean);
  const outro = compactBlankLines(outroSegments.join("\n\n").split("\n")).join("\n");

  return {
    subject: payload.subject,
    body,
    outro,
    sections,
    sendBody: body,
    copyPayload: `Subject: ${payload.subject}\n\n${body}`.trim(),
  };
}

/**
 * Splits content containing multiple embedded email drafts into discrete drafts.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param input - Input value for splitEmbeddedEmailDrafts.
 * @returns Return value from splitEmbeddedEmailDrafts.
 *
 * @example
 * ```typescript
 * const output = splitEmbeddedEmailDrafts(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
export function splitEmbeddedEmailDrafts(input: Partial<EmailDraftPayload>): EmailDraftPayload[] {
  const base = parseEmailDraftPayload(input);
  const body = normalizeEmailText(base.body);
  if (!body.trim()) return [base];
  const matches = Array.from(body.matchAll(EMAIL_SUBJECT_MATCH_ALL_PATTERN))
    .map((match) => {
      let start = typeof match.index === "number" ? match.index : -1;
      if (start >= 0 && body[start] === "\n") start += 1;
      return {
        start,
        subject: String(match[1] || "").trim().replace(/^\**|\**$/g, ""),
      };
    })
    .filter((item) => item.start >= 0 && !!item.subject);

  if (matches.length <= 1) return [base];
  const drafts: EmailDraftPayload[] = [];
  let pendingSeparator: string | undefined;
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const next = matches[i + 1];
    const segment = body.slice(current.start, next ? next.start : body.length).trim();
    const rawAfterSubject = segment.replace(/^\s*\**subject\**\s*:\s*.+\n?/i, "").trim();
    const extracted = extractTrailingVariantHeader(normalizeEmailText(rawAfterSubject).split("\n"));
    const afterSubject = compactBlankLines(extracted.bodyLines).join("\n").trim();
    if (!afterSubject) continue;
    const parsed = parseEmailDraftPayload({
      subject: current.subject,
      body: afterSubject,
      separatorBefore: pendingSeparator,
    });
    drafts.push(parsed);
    pendingSeparator = extracted.separator;
  }

  if (drafts.length <= 1) return [base];
  drafts[0].intro = base.intro;
  drafts[drafts.length - 1].outro = base.outro;
  if (pendingSeparator) {
    const existingOutro = drafts[drafts.length - 1].outro?.trim();
    drafts[drafts.length - 1].outro = [pendingSeparator, existingOutro].filter(Boolean).join("\n\n");
  }
  if (Array.isArray(base.signature) && base.signature.length) {
    drafts[drafts.length - 1].signature = base.signature;
  }
  return drafts;
}
