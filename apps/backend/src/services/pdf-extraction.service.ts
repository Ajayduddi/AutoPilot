/**
 * @fileoverview services/pdf-extraction.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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
    await execFileAsync('which', [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function safeUnlink(filePath: string) {
  try {
    await fs.unlink(filePath);
  } catch {
    // best effort
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
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-pdf-'));
        const inputPath = path.join(tempRoot, `${randomUUID()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    await fs.writeFile(inputPath, Buffer.from(bytes));

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
                    const info = await execFileAsync('pdfinfo', [inputPath], { maxBuffer: 1024 * 1024 });
                    const m = info.stdout.match(/Pages:\s+(\d+)/i);
          if (m) pages = Number(m[1]) || 0;
        } catch {
          // ignore
        }
      }

      if (hasPdfToText) {
        try {
                    const out = await execFileAsync('pdftotext', ['-layout', '-enc', 'UTF-8', inputPath, '-'], {
            maxBuffer: 30 * 1024 * 1024,
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
                    const imgPrefix = path.join(tempRoot, `ocr-${randomUUID()}`);
          try {
            await execFileAsync('pdftoppm', ['-png', '-r', '150', inputPath, imgPrefix], { maxBuffer: 10 * 1024 * 1024 });
                        const files = (await fs.readdir(tempRoot))
              .filter((f) => f.startsWith(path.basename(imgPrefix)) && f.endsWith('.png'))
              .sort();

                        const ocrTexts: string[] = [];
            for (const file of files) {
                            const imgPath = path.join(tempRoot, file);
              try {
                                const ocr = await execFileAsync('tesseract', [imgPath, 'stdout', '-l', 'eng'], { maxBuffer: 10 * 1024 * 1024 });
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
      try {
                const files = await fs.readdir(tempRoot);
        await Promise.all(files.map((f) => safeUnlink(path.join(tempRoot, f))));
        await fs.rmdir(tempRoot);
      } catch {
        // best effort
      }
    }
  }
}

