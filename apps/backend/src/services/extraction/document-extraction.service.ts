/**
 * @fileoverview services/document-extraction.service.
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
import { getRuntimeConfig } from '../../config/runtime.config';
import { safeExec } from '../../util/safe-exec';
import { createTempWorkspace } from '../../util/temp-workspace';

/**
 * ExtractionQuality type alias.
 */
export type ExtractionQuality = 'good' | 'partial' | 'failed';
/**
 * ExtractionSource type alias.
 */
export type ExtractionSource = 'doc_text' | 'sheet_text' | 'plain_text' | 'mixed' | 'none';

/**
 * DocumentChunk type alias.
 */
export type DocumentChunk = {
    content: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
};

/**
 * DocumentExtractionResult type alias.
 */
export type DocumentExtractionResult = {
    text: string;
    chunks: DocumentChunk[];
    quality: ExtractionQuality;
    source: ExtractionSource;
    stats: Record<string, unknown>;
  error?: string | null;
};
const CHUNK_TARGET = 1400;
const CHUNK_OVERLAP = 120;
const EXTRACTION_COMMANDS = ["which", "unzip", "antiword", "xls2csv"] as const;

function getExtractionLimits() {
  const extraction = getRuntimeConfig().extraction;
  const renderRows = Math.max(50, extraction.xlsxMaxRowsRenderPerSheet);
  const parseRows = Math.max(renderRows, extraction.xlsxMaxRowsParsePerSheet);
  return {
    xlsxMaxCols: Math.max(1, extraction.xlsxMaxCols),
    xlsxMaxRowsRenderPerSheet: renderRows,
    xlsxMaxRowsParsePerSheet: parseRows,
  };
}
function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
function splitParagraphAware(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
    const normalized = normalizeText(text);
  if (!normalized) return [];
    const paragraphs = normalized.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    const pushCurrent = () => {
        const payload = current.trim();
    if (!payload) return;
    chunks.push(payload);
    current = '';
  };

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).trim().length <= target) {
      current = current ? `${current}\n\n${para}` : para;
      continue;
    }
    if (current) pushCurrent();
    if (para.length <= target) {
      current = para;
      continue;
    }
        let i = 0;
    while (i < para.length) {
            const piece = para.slice(i, i + target);
      chunks.push(piece.trim());
      i += Math.max(1, target - overlap);
    }
  }
  if (current) pushCurrent();
  return chunks;
}
function xmlDecode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
function colLabelToIndex(label: string): number {
    let out = 0;
  for (const ch of label.toUpperCase()) {
    out = out * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(1, out) - 1;
}
function parseCellRef(ref: string): { row: number; col: number } {
    const m = ref.match(/^([A-Za-z]+)(\d+)$/);
  if (!m) return { row: 0, col: 0 };
  return { col: colLabelToIndex(m[1]), row: Math.max(1, Number(m[2])) - 1 };
}
function buildChunks(text: string, source: ExtractionSource, extraMeta: Record<string, unknown> = {}): DocumentChunk[] {
  return splitParagraphAware(text).map((content, idx) => ({
    content,
    tokenCount: estimateTokens(content),
    metadata: { source, chunkIndex: idx, ...extraMeta },
  }));
}
async function commandExists(cmd: string): Promise<boolean> {
  try {
    await safeExec('which', {
      args: [cmd],
      timeoutMs: 3_000,
      maxOutputBytes: 64 * 1024,
      allowedCommands: EXTRACTION_COMMANDS,
    });
    return true;
  } catch {
    return false;
  }
}
async function extractZipEntry(filePath: string, entryPath: string): Promise<string> {
    const out = await safeExec('unzip', {
      args: ['-p', filePath, entryPath],
      timeoutMs: 20_000,
      maxOutputBytes: 20 * 1024 * 1024,
      allowedCommands: EXTRACTION_COMMANDS,
    });
  return String(out.stdout || '');
}
async function listZipEntries(filePath: string): Promise<string[]> {
    const out = await safeExec('unzip', {
      args: ['-Z1', filePath],
      timeoutMs: 20_000,
      maxOutputBytes: 20 * 1024 * 1024,
      allowedCommands: EXTRACTION_COMMANDS,
    });
  return String(out.stdout || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}
function scoreQuality(totalChars: number, densityHint = 1): ExtractionQuality {
  if (totalChars >= 3000 * densityHint) return 'good';
  if (totalChars >= 300) return 'partial';
  return 'failed';
}
async function extractPlainText(bytes: Uint8Array, source: ExtractionSource): Promise<DocumentExtractionResult> {
    const text = normalizeText(new TextDecoder('utf-8', { fatal: false }).decode(bytes));
    const quality = scoreQuality(text.length);
  return {
    text,
    chunks: buildChunks(text, source),
    quality,
    source,
    stats: { totalChars: text.length, lines: text ? text.split('\n').length : 0 },
        error: quality === 'failed' ? 'No meaningful text extracted.' : null,
  };
}
async function extractDocx(filePath: string): Promise<DocumentExtractionResult> {
    const hasUnzip = await commandExists('unzip');
  if (!hasUnzip) {
    return { text: '', chunks: [], quality: 'failed', source: 'none', stats: {}, error: 'unzip is not installed for DOCX parsing.' };
  }

    const xml = await extractZipEntry(filePath, 'word/document.xml').catch(() => '');
    const paragraphTexts: string[] = [];
    const paraRe = /<w:p[\s\S]*?<\/w:p>/g;
    const textRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const paragraphs = xml.match(paraRe) || [];
  for (const para of paragraphs) {
        const bits: string[] = [];
        let m: RegExpExecArray | null;
    while ((m = textRe.exec(para)) !== null) {
      bits.push(xmlDecode(m[1]));
    }
        const line = normalizeText(bits.join(' '));
    if (line) paragraphTexts.push(line);
  }
    const text = normalizeText(paragraphTexts.join('\n\n'));
    const quality = scoreQuality(text.length);
  return {
    text,
    chunks: buildChunks(text, 'doc_text'),
    quality,
    source: text ? 'doc_text' : 'none',
    stats: { paragraphs: paragraphTexts.length, totalChars: text.length },
        error: quality === 'failed' ? 'Could not extract DOCX paragraph text.' : null,
  };
}
async function extractDocLegacy(filePath: string): Promise<DocumentExtractionResult> {
    const hasAntiword = await commandExists('antiword');
  if (!hasAntiword) {
    return { text: '', chunks: [], quality: 'partial', source: 'none', stats: {}, error: 'antiword is not installed for .doc parsing.' };
  }
    const out = await safeExec('antiword', {
      args: [filePath],
      timeoutMs: 20_000,
      maxOutputBytes: 20 * 1024 * 1024,
      allowedCommands: EXTRACTION_COMMANDS,
    }).catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
    const text = normalizeText(String(out.stdout || ''));
    const quality = scoreQuality(text.length);
  return {
    text,
    chunks: buildChunks(text, 'doc_text'),
    quality,
    source: text ? 'doc_text' : 'none',
    stats: { totalChars: text.length },
        error: quality === 'failed' ? 'Could not extract readable content from .doc file.' : null,
  };
}
async function extractXlsx(filePath: string): Promise<DocumentExtractionResult> {
    const limits = getExtractionLimits();
    const hasUnzip = await commandExists('unzip');
  if (!hasUnzip) {
    return { text: '', chunks: [], quality: 'failed', source: 'none', stats: {}, error: 'unzip is not installed for XLSX parsing.' };
  }
    const entries = await listZipEntries(filePath);
    const sharedStringsXml = entries.includes('xl/sharedStrings.xml')
    ? await extractZipEntry(filePath, 'xl/sharedStrings.xml').catch(() => '')
    : '';
    const sharedStrings = [...sharedStringsXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1]));

    const workbookXml = entries.includes('xl/workbook.xml')
    ? await extractZipEntry(filePath, 'xl/workbook.xml').catch(() => '')
    : '';
    const sheetNames = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((m) => m[1]);
    const sheetEntries = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(e))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const renderedSheets: string[] = [];
    let rowsTotal = 0;
    let rowsParsed = 0;
    let rowsRendered = 0;
  for (let si = 0; si < sheetEntries.length; si++) {
        const sheetXml = await extractZipEntry(filePath, sheetEntries[si]).catch(() => '');
        const rows = [...sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)];
    rowsTotal += rows.length;
        const tableAll: string[][] = [];
        const maxRows = Math.min(rows.length, limits.xlsxMaxRowsParsePerSheet);
    for (let ri = 0; ri < maxRows; ri++) {
            const rowXml = rows[ri][1];
            const cells = [...rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)];
            const row: string[] = [];
      for (const cell of cells) {
                const attrs = cell[1] || '';
                const body = cell[2] || '';
                const refMatch = attrs.match(/\sr="([^"]+)"/);
                const typeMatch = attrs.match(/\st="([^"]+)"/);
                const vMatch = body.match(/<v>([\s\S]*?)<\/v>/);
                const isMatch = body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
                let value = '';
        if (isMatch) value = xmlDecode(isMatch[1]);
        else if (vMatch) {
                    const raw = xmlDecode(vMatch[1]);
          if (typeMatch?.[1] === 's') {
                        const idx = Number(raw);
            value = Number.isFinite(idx) ? (sharedStrings[idx] || '') : raw;
          } else {
            value = raw;
          }
        }
                const col = refMatch?.[1] ? parseCellRef(refMatch[1]).col : row.length;
        if (col < limits.xlsxMaxCols) {
          while (row.length < col) row.push('');
          row[col] = normalizeText(value);
        }
      }
      if (row.some((v) => v && v.trim().length > 0)) {
        tableAll.push(row.slice(0, limits.xlsxMaxCols));
      }
    }
    rowsParsed += tableAll.length;
        const sheetName = sheetNames[si] || `Sheet${si + 1}`;
    if (!tableAll.length) continue;
        const tableRendered = tableAll.slice(0, limits.xlsxMaxRowsRenderPerSheet);
    rowsRendered += tableRendered.length;
        const lines = tableRendered.map((r) => r.map((v) => (v || '').replace(/\|/g, '/')).join(' | '));
    renderedSheets.push(`Sheet: ${sheetName}\n${lines.join('\n')}`);
  }

    const text = normalizeText(renderedSheets.join('\n\n'));
    const quality = scoreQuality(text.length, 0.8);
    const parseCoverage: 'full' | 'partial' =
    rowsTotal > limits.xlsxMaxRowsParsePerSheet * Math.max(1, sheetEntries.length) ? 'partial' : 'full';
  return {
    text,
    chunks: buildChunks(text, 'sheet_text'),
    quality,
    source: text ? 'sheet_text' : 'none',
    stats: {
      sheets: sheetEntries.length,
      sheetsWithData: renderedSheets.length,
      rowsTotal,
      rowsParsed,
      rowsRendered,
      rowsSampled: rowsRendered,
      coverage: parseCoverage,
      totalChars: text.length,
    },
        error: quality === 'failed' ? 'Could not extract worksheet content from XLSX.' : null,
  };
}
async function extractXlsLegacy(filePath: string): Promise<DocumentExtractionResult> {
    const limits = getExtractionLimits();
    const hasXls2csv = await commandExists('xls2csv');
  if (!hasXls2csv) {
    return { text: '', chunks: [], quality: 'partial', source: 'none', stats: {}, error: 'xls2csv is not installed for .xls parsing.' };
  }
    const out = await safeExec('xls2csv', {
      args: [filePath],
      timeoutMs: 20_000,
      maxOutputBytes: 20 * 1024 * 1024,
      allowedCommands: EXTRACTION_COMMANDS,
    }).catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
    const csv = normalizeText(String(out.stdout || ''));
    const allLines = csv.split('\n').filter((line) => line.trim().length > 0);
    const rendered = allLines.slice(0, limits.xlsxMaxRowsRenderPerSheet);
    const text = normalizeText(`Sheet: Sheet1\n${rendered.join('\n')}`);
    const quality = scoreQuality(text.length, 0.8);
  return {
    text,
    chunks: buildChunks(text, 'sheet_text'),
    quality,
    source: text ? 'sheet_text' : 'none',
    stats: {
      sheets: 1,
      rowsTotal: allLines.length,
      rowsParsed: allLines.length,
      rowsRendered: rendered.length,
      rowsSampled: rendered.length,
      coverage: 'full',
      totalChars: text.length,
    },
        error: quality === 'failed' ? 'Could not extract .xls content.' : null,
  };
}

/**
 * DocumentExtractionService class.
 *
 * Encapsulates document extraction service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class DocumentExtractionService {
  static async extract(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<DocumentExtractionResult> {
        const ext = (input.filename.split('.').pop() || '').toLowerCase();
        const mime = (input.mimeType || '').toLowerCase();
        const workspace = await createTempWorkspace('chat-doc');
        const filePath = await workspace.createFile(input.filename, input.bytes);

    try {
      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || ext === 'txt' || ext === 'md') {
        return extractPlainText(input.bytes, 'plain_text');
      }
      if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') {
        return await extractDocx(filePath);
      }
      if (mime === 'application/msword' || ext === 'doc') {
        return await extractDocLegacy(filePath);
      }
      if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx') {
        return await extractXlsx(filePath);
      }
      if (mime === 'application/vnd.ms-excel' || ext === 'xls') {
        return await extractXlsLegacy(filePath);
      }
      return {
        text: '',
        chunks: [],
        quality: 'failed',
        source: 'none',
        stats: { totalChars: 0 },
        error: 'Unsupported document type for deep parsing.',
      };
    } finally {
      await workspace.cleanup();
    }
  }
}
