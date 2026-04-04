/**
 * @fileoverview services/attachment-processing.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import { createHash } from 'crypto';
import { LLMService } from './llm.service';
import { PdfExtractionService } from './pdf-extraction.service';
import { DocumentExtractionService } from './document-extraction.service';
import { getRuntimeConfig } from '../config/runtime.config';
import { AttachmentScanService } from './attachment-scan.service';

type ProcessingStatus = 'uploaded' | 'processing' | 'processed' | 'failed' | 'not_parsable';
type ExtractionQuality = 'good' | 'partial' | 'failed';

/**
 * ProcessedAttachment type alias.
 */
export type ProcessedAttachment = {
    processingStatus: ProcessingStatus;
  extractedText?: string | null;
  structuredMetadata?: Record<string, unknown> | null;
  previewData?: Record<string, unknown> | null;
  error?: string | null;
  extractionQuality?: ExtractionQuality;
  extractionStats?: {
    pages?: number;
    pagesWithText?: number;
    ocrPages?: number;
    totalChars?: number;
    confidence?: number;
  } | null;
  chunks?: Array<{
        content: string;
        tokenCount: number;
        metadata: Record<string, unknown>;
  }>;
};

const DOC_MIME_ALLOW = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

/**
 * AttachmentProcessingService class.
 *
 * Encapsulates attachment processing service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AttachmentProcessingService {
    private static readonly BLOCKED_FILE_MAGIC: Array<{ label: string; bytes: number[] }> = [
    { label: 'windows_executable', bytes: [0x4d, 0x5a] }, // MZ
    { label: 'elf_executable', bytes: [0x7f, 0x45, 0x4c, 0x46] }, // ELF
    { label: 'mach_o_32', bytes: [0xfe, 0xed, 0xfa, 0xce] },
    { label: 'mach_o_64', bytes: [0xfe, 0xed, 0xfa, 0xcf] },
  ];

    private static hasMagicPrefix(bytes: Uint8Array, prefix: number[]): boolean {
    if (bytes.length < prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) {
      if (bytes[i] !== prefix[i]) return false;
    }
    return true;
  }

  private static scanForUnsafeContent(input: { filename: string; mimeType: string; bytes: Uint8Array }): {
        blocked: boolean;
    reason?: string;
        flags: string[];
  } {
        const flags: string[] = [];
        const mime = (input.mimeType || '').toLowerCase();
        const filename = (input.filename || '').toLowerCase();

    for (const magic of this.BLOCKED_FILE_MAGIC) {
      if (this.hasMagicPrefix(input.bytes, magic.bytes)) {
        return { blocked: true, reason: `Blocked executable attachment (${magic.label}).`, flags: [magic.label] };
      }
    }

    if (/\.(exe|dll|so|dylib|bat|cmd|ps1|sh|apk|msi)$/i.test(filename)) {
      return { blocked: true, reason: 'Blocked potentially executable attachment by extension.', flags: ['blocked_extension'] };
    }

    if (mime === 'image/svg+xml' || filename.endsWith('.svg') || mime.startsWith('text/')) {
            const preview = new TextDecoder('utf-8', { fatal: false }).decode(input.bytes.slice(0, 20_000)).toLowerCase();
      if (/<script\b|javascript:|onload=|onerror=|data:text\/html/i.test(preview)) {
        flags.push('active_script_markup_detected');
      }
      if (/ignore previous instructions|system prompt|developer prompt|exfiltrate|override safety/i.test(preview)) {
        flags.push('prompt_injection_pattern_detected');
      }
    }

    return { blocked: false, flags };
  }

  private static readonly DEFAULT_ALLOWED_MIME_TYPES = [
    'image/*',
    'audio/*',
    'text/*',
    'application/json',
    'application/xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];

    static inferMimeFromFilename(filename: string): string | null {
        const ext = (filename.split('.').pop() || '').toLowerCase();
    if (!ext) return null;
        const map: Record<string, string> = {
      svg: 'image/svg+xml',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      txt: 'text/plain',
      csv: 'text/csv',
      md: 'text/markdown',
      json: 'application/json',
      xml: 'application/xml',
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      oga: 'audio/ogg',
      ogg: 'audio/ogg',
      flac: 'audio/flac',
    };
    return map[ext] || null;
  }

    static getAllowedMimeTypes() {
        const merged = new Set<string>([
      ...this.DEFAULT_ALLOWED_MIME_TYPES.map((s) => s.toLowerCase()),
      ...getRuntimeConfig().attachments.allowedMimeTypes,
    ]);
    return Array.from(merged);
  }

    static isMimeAllowed(mimeType: string, filename?: string) {
        const normalizedMime = (mimeType || '').toLowerCase();
        const inferred = this.inferMimeFromFilename(filename || '');
        const candidates = [normalizedMime, inferred].filter(Boolean) as string[];
        const allowed = this.getAllowedMimeTypes();
    if (!candidates.length) return false;
    return candidates.some((candidate) =>
      allowed.some((entry) => {
                const normalizedEntry = entry.toLowerCase();
        if (normalizedEntry.endsWith('/*')) return candidate.startsWith(normalizedEntry.slice(0, -1));
        return normalizedEntry === candidate;
      })
    );
  }

    static getMaxUploadBytes() {
        const maxMb = getRuntimeConfig().attachments.maxUploadMb;
    return Math.max(1, maxMb) * 1024 * 1024;
  }

    static getMaxFilesPerMessage() {
        const n = getRuntimeConfig().attachments.maxFilesPerMessage;
    return Math.max(1, n);
  }

    static checksum(bytes: Uint8Array) {
    return createHash('sha256').update(bytes).digest('hex');
  }

    static getProcessingTimeoutMs() {
        const ms = getRuntimeConfig().attachments.processTimeoutMs;
    return Math.max(2_000, ms);
  }

  private static async deterministicProcessAttachment(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ProcessedAttachment> {
    try {
            const mime = (input.mimeType || '').toLowerCase();
            const size = input.bytes.byteLength;
            const extension = input.filename.split('.').pop()?.toLowerCase() || '';

      if (mime.startsWith('image/')) {
        return {
          processingStatus: 'processed',
          extractedText: null,
                    structuredMetadata: { kind: 'image', extension, sizeBytes: size, note: 'image uploaded; OCR/vision fallback unavailable' },
          previewData: { summary: `Image file ${input.filename} (${Math.round(size / 1024)} KB)` },
        };
      }

      if (mime.startsWith('audio/')) {
        return {
          processingStatus: 'processed',
          extractedText: null,
                    structuredMetadata: { kind: 'audio', extension, sizeBytes: size, note: 'audio uploaded; transcription fallback unavailable' },
          previewData: { summary: `Audio file ${input.filename} (${Math.round(size / 1024)} KB)` },
        };
      }

      if (DOC_MIME_ALLOW.has(mime)) {
        if (mime === 'application/pdf') {
                    const pdf = await PdfExtractionService.extract(input.bytes, input.filename);
          return {
                        processingStatus: pdf.quality === 'failed' ? 'failed' : 'processed',
            extractedText: pdf.text || null,
            structuredMetadata: {
              kind: 'document',
              extension,
              mimeType: mime,
              sizeBytes: size,
              extractionQuality: pdf.quality,
              extractionStats: pdf.stats,
              extractionSource: pdf.source,
            },
            previewData: {
              summary:
                pdf.quality === 'good'
                  ? 'PDF text extracted with high confidence.'
                  : pdf.quality === 'partial'
                    ? 'PDF partially extracted. OCR fallback may be used.'
                    : 'PDF extraction failed.',
              snippet: pdf.text ? pdf.text.slice(0, 400) : undefined,
            },
            extractionQuality: pdf.quality,
            extractionStats: pdf.stats,
            chunks: pdf.chunks,
                        error: pdf.quality === 'failed' ? 'Could not extract readable text from PDF.' : null,
          };
        }
                const doc = await DocumentExtractionService.extract({
          filename: input.filename,
          mimeType: mime,
          bytes: input.bytes,
        });
        return {
                    processingStatus: doc.quality === 'failed' ? 'failed' : 'processed',
          extractedText: doc.text || null,
          structuredMetadata: {
            kind: 'document',
            extension,
            mimeType: mime,
            sizeBytes: size,
            extractionQuality: doc.quality,
            extractionStats: doc.stats,
            extractionSource: doc.source,
          },
          previewData: {
            summary:
              doc.quality === 'good'
                ? 'Document extracted with high confidence.'
                : doc.quality === 'partial'
                  ? 'Document partially extracted.'
                  : 'Document extraction failed.',
            snippet: doc.text ? doc.text.slice(0, 400) : undefined,
          },
          extractionQuality: doc.quality,
          extractionStats: doc.stats as any,
          chunks: doc.chunks,
          error: doc.error || null,
        };
      }

      if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
                const plain = await DocumentExtractionService.extract({
          filename: input.filename,
          mimeType: mime,
          bytes: input.bytes,
        });
        return {
                    processingStatus: plain.quality === 'failed' ? 'failed' : 'processed',
          extractedText: plain.text || null,
          structuredMetadata: {
            kind: 'text',
            extension,
            mimeType: mime,
            sizeBytes: size,
            extractionQuality: plain.quality,
            extractionStats: plain.stats,
            extractionSource: plain.source,
          },
          previewData: {
            summary:
              plain.quality === 'good'
                ? 'Text extracted successfully.'
                : plain.quality === 'partial'
                  ? 'Text partially extracted.'
                  : 'Text extraction failed.',
            snippet: plain.text ? plain.text.slice(0, 400) : undefined,
          },
          extractionQuality: plain.quality,
          extractionStats: plain.stats as any,
          chunks: plain.chunks,
          error: plain.error || null,
        };
      }

      return {
        processingStatus: 'not_parsable',
        extractedText: null,
        structuredMetadata: { kind: 'binary', extension, mimeType: mime, sizeBytes: size },
        previewData: { summary: `Binary file uploaded (${input.filename})` },
        error: 'This file type is not parsable in the current configuration.',
      };
    } catch (err: any) {
      return {
        processingStatus: 'failed',
        error: err?.message || 'Attachment processing failed',
      };
    }
  }

  private static async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Attachment processing timeout')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  static async processAttachment(
        input: { filename: string; mimeType: string; bytes: Uint8Array },
    options?: { providerId?: string; model?: string },
  ): Promise<ProcessedAttachment> {
        const scanResult = await AttachmentScanService.scan(input);
    if (scanResult.status === 'infected') {
      return {
        processingStatus: 'failed',
        extractedText: null,
        structuredMetadata: {
          kind: 'blocked',
          mimeType: input.mimeType,
          contentSafety: {
            blocked: true,
            source: 'malware_scanner',
            signature: scanResult.signature,
          },
        },
        error: `Attachment blocked by malware scanner (${scanResult.signature}).`,
      };
    }
    if (scanResult.status === 'error' && AttachmentScanService.shouldBlockOnScanError()) {
      return {
        processingStatus: 'failed',
        extractedText: null,
        structuredMetadata: {
          kind: 'blocked',
          mimeType: input.mimeType,
          contentSafety: {
            blocked: true,
            source: 'malware_scanner',
            reason: scanResult.reason,
          },
        },
        error: 'Attachment scanning failed and fail-closed mode is enabled.',
      };
    }

        const safety = this.scanForUnsafeContent(input);
    if (safety.blocked) {
      return {
        processingStatus: 'failed',
        extractedText: null,
        structuredMetadata: {
          kind: 'blocked',
          mimeType: input.mimeType,
          contentSafety: {
            blocked: true,
            flags: safety.flags,
            reason: safety.reason,
          },
        },
        error: safety.reason || 'Attachment blocked by security policy.',
      };
    }

        const fallback = await this.deterministicProcessAttachment(input);
        const mime = (input.mimeType || '').toLowerCase();
        const isLocalAuthoritativeDoc =
      (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || (DOC_MIME_ALLOW.has(mime) && mime !== 'application/pdf'));

    try {
            const providerResult = await this.withTimeout(
        LLMService.analyzeAttachmentWithProvider(
          {
            filename: input.filename,
            mimeType: input.mimeType,
            bytes: input.bytes,
            extractedTextHint: fallback.extractedText || null,
          },
          options?.providerId,
          options?.model,
        ),
        this.getProcessingTimeoutMs(),
      );

      if (!providerResult) {
        return fallback;
      }

            const mergedStructured = {
        ...(fallback.structuredMetadata || {}),
        ...(providerResult.structuredMetadata || {}),
        processingPath: 'provider_native',
        contentSafety: {
          blocked: false,
          scanner: scanResult.status,
          flags: safety.flags,
        },
      } as Record<string, unknown>;
      if ('note' in mergedStructured) delete mergedStructured.note;

      return {
        processingStatus: 'processed',
        extractedText: isLocalAuthoritativeDoc
          ? (fallback.extractedText ?? providerResult.extractedText ?? null)
          : (providerResult.extractedText ?? fallback.extractedText ?? null),
        structuredMetadata: mergedStructured,
        previewData: {
          ...(fallback.previewData || {}),
          ...(providerResult.previewData || {}),
        },
        error: null,
        extractionQuality:
          isLocalAuthoritativeDoc
            ? ((fallback.structuredMetadata as any)?.extractionQuality ?? fallback.extractionQuality ?? 'partial')
            : ((providerResult.structuredMetadata as any)?.extractionQuality ??
              (fallback.structuredMetadata as any)?.extractionQuality ??
              fallback.extractionQuality ??
              'partial'),
        extractionStats:
          isLocalAuthoritativeDoc
            ? ((fallback.structuredMetadata as any)?.extractionStats ?? fallback.extractionStats ?? null)
            : ((providerResult.structuredMetadata as any)?.extractionStats ??
              (fallback.structuredMetadata as any)?.extractionStats ??
              fallback.extractionStats ??
              null),
        chunks: fallback.chunks || [],
      };
    } catch (err: any) {
      return {
        ...fallback,
        structuredMetadata: {
          ...(fallback.structuredMetadata || {}),
          processingPath: 'deterministic_fallback',
          contentSafety: {
            blocked: false,
            scanner: scanResult.status,
            flags: safety.flags,
          },
        },
        error: fallback.error || err?.message || null,
      };
    }
  }
}
