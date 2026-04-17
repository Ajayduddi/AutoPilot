/**
 * @fileoverview services/pdf-extraction.service.
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
import { createTempWorkspace } from '../../util/temp-workspace';
import { safeExec } from '../../util/safe-exec';

/**
 * ExtractionQuality type alias.
 */
export type ExtractionQuality = 'good' | 'partial' | 'failed';

/**
 * PdfChunk type alias.
 */
export type PdfChunk = {
    content: string;
    tokenCount: number;
    metadata: Record<string, unknown>;
};

/**
 * PdfExtractionResult type alias.
 */
export type PdfExtractionResult = {
    text: string;
    chunks: PdfChunk[];
    quality: ExtractionQuality;
  stats: {
        pages: number;
        pagesWithText: number;
        ocrPages: number;
        totalChars: number;
        confidence: number;
  };
    source: 'pdf_text' | 'ocr' | 'mixed' | 'none';
};

const CHUNK_TARGET = 1400;
const CHUNK_OVERLAP = 120;
const PDF_EXTRACTION_COMMANDS = ["which", "pdfinfo", "pdftotext", "pdftoppm", "tesseract"] as const;

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

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await safeExec('which', {
      args: [cmd],
      timeoutMs: 3_000,
      maxOutputBytes: 64 * 1024,
      allowedCommands: PDF_EXTRACTION_COMMANDS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * PdfExtractionService class.
 *
 * Encapsulates pdf extraction service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class PdfExtractionService {
    static async extract(bytes: Uint8Array, filename = 'document.pdf'): Promise<PdfExtractionResult> {
        const workspace = await createTempWorkspace('chat-pdf');
        const inputPath = await workspace.createFile(filename, bytes);

        let pages = 0;
        let pagesWithText = 0;
        let ocrPages = 0;
        let source: PdfExtractionResult['source'] = 'none';
        let extractedText = '';

    try {
            const hasPdfToText = await commandExists('pdftotext');
            const hasPdfInfo = await commandExists('pdfinfo');

      if (hasPdfInfo) {
        try {
                    const info = await safeExec('pdfinfo', {
            args: [inputPath],
            timeoutMs: 10_000,
            maxOutputBytes: 1024 * 1024,
            allowedCommands: PDF_EXTRACTION_COMMANDS,
          });
                    const m = info.stdout.match(/Pages:\s+(\d+)/i);
          if (m) pages = Number(m[1]) || 0;
        } catch {
          // ignore
        }
      }

      if (hasPdfToText) {
        try {
                    const out = await safeExec('pdftotext', {
            args: ['-layout', '-enc', 'UTF-8', inputPath, '-'],
            timeoutMs: 30_000,
            maxOutputBytes: 30 * 1024 * 1024,
            allowedCommands: PDF_EXTRACTION_COMMANDS,
          });
          extractedText = normalizeText(out.stdout || '');
                    const perPage = (out.stdout || '').split('\f');
          pagesWithText = perPage.filter((p) => normalizeText(p).length >= 40).length;
          if (!pages && perPage.length > 1) pages = perPage.length;
          if (extractedText.length > 0) source = 'pdf_text';
        } catch {
          // continue to OCR fallback
        }
      }

            const lowCoverage = !extractedText || extractedText.length < 500 || (pages > 0 && pagesWithText / Math.max(1, pages) < 0.4);
      if (lowCoverage) {
        const hasPdftoppm = await commandExists('pdftoppm');
                const hasTesseract = await commandExists('tesseract');
        if (hasPdftoppm && hasTesseract) {
                    const imgPrefix = workspace.resolve(`ocr-${crypto.randomUUID()}`);
          try {
            await safeExec('pdftoppm', {
              args: ['-png', '-r', '150', inputPath, imgPrefix],
              timeoutMs: 20_000,
              maxOutputBytes: 10 * 1024 * 1024,
              allowedCommands: PDF_EXTRACTION_COMMANDS,
            });
                        const imgPrefixBase = imgPrefix.split('/').pop() || '';
                        const files = (await workspace.listEntries())
              .filter((f) => f.startsWith(imgPrefixBase) && f.endsWith('.png'))
              .sort();

            const ocrTexts: string[] = [];
            for (const file of files) {
                            const imgPath = workspace.resolve(file);
              try {
                                const ocr = await safeExec('tesseract', {
                  args: [imgPath, 'stdout', '-l', 'eng'],
                  timeoutMs: 20_000,
                  maxOutputBytes: 10 * 1024 * 1024,
                  allowedCommands: PDF_EXTRACTION_COMMANDS,
                });
                                const t = normalizeText(ocr.stdout || '');
                if (t) {
                  ocrTexts.push(t);
                  ocrPages += 1;
                }
              } catch {
                // ignore page-level OCR failures
              }
            }
            if (ocrTexts.length) {
                            const ocrText = normalizeText(ocrTexts.join('\n\n'));
              extractedText = normalizeText([extractedText, ocrText].filter(Boolean).join('\n\n'));
              source = source === 'pdf_text' ? 'mixed' : 'ocr';
              if (!pages) pages = files.length;
              if (!pagesWithText) pagesWithText = ocrPages;
            }
          } catch {
            // ignore OCR pipeline failure
          }
        }
      }

            const chunks = splitParagraphAware(extractedText).map((content, idx) => ({
        content,
        tokenCount: estimateTokens(content),
        metadata: {
          source,
          chunkIndex: idx,
        },
      }));

            const totalChars = extractedText.length;
            const density = pages > 0 ? totalChars / Math.max(1, pages) : totalChars;
            const coverage = pages > 0 ? pagesWithText / Math.max(1, pages) : (totalChars > 0 ? 1 : 0);
            const confidence = Math.max(0, Math.min(1, (coverage * 0.7) + (Math.min(1, density / 1200) * 0.3)));

            let quality: ExtractionQuality = 'failed';
      if (totalChars >= 3000 && coverage >= 0.7) quality = 'good';
      else if (totalChars >= 300 && coverage >= 0.2) quality = 'partial';

      return {
        text: extractedText,
        chunks,
        quality,
        stats: {
          pages,
          pagesWithText,
          ocrPages,
          totalChars,
          confidence,
        },
        source,
      };
    } finally {
      await workspace.cleanup();
    }
  }
}
