/**
 * @fileoverview apps/backend/src/services/extraction/mistral-ocr.service.ts
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
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { LLMFactory } from '../../providers/llm/llm.factory';
import { bytesToDataUrl } from '../../util/byte-utils';
import { getRuntimeConfig } from '../../config/runtime.config';
import { ProviderConfigRepo } from '../../repositories/provider-config.repo';

type OcrQuality = 'good' | 'partial' | 'failed';

type OcrChunk = {
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
};

export type MistralOcrResult = {
  text: string;
  quality: OcrQuality;
  chunks: OcrChunk[];
  stats: {
    pages: number;
    pagesWithText: number;
    totalChars: number;
  };
  source: 'mistral_ocr';
  model: string;
};

type MistralOcrResponse = {
  model?: string;
  pages?: Array<{
    index?: number;
    markdown?: string;
    text?: string;
  }>;
};

const CHUNK_TARGET = 1400;
const CHUNK_OVERLAP = 120;

function normalizeText(input: string): string {
  return String(input || '')
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

function scoreQuality(totalChars: number): OcrQuality {
  if (totalChars >= 3000) return 'good';
  if (totalChars >= 300) return 'partial';
  return 'failed';
}

export class MistralOcrService {
  private static cachedConfig: {
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
    expiresAt: number;
  } | null = null;

  static supportsMimeType(mimeType: string): boolean {
    const mime = String(mimeType || '').toLowerCase();
    return mime === 'application/pdf' || mime.startsWith('image/');
  }

  static async isAvailable(): Promise<boolean> {
    const config = await this.resolveProviderConfig();
    const key = config.apiKey;
    return Boolean(key);
  }

  static async extract(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<MistralOcrResult> {
    const providerConfig = await this.resolveProviderConfig();
    const apiKey = providerConfig.apiKey;
    if (!apiKey) {
      throw new Error('Mistral OCR is not configured.');
    }
    if (!this.supportsMimeType(input.mimeType)) {
      throw new Error(`Mistral OCR does not support mime type: ${input.mimeType}`);
    }

    const runtimeOcr = getRuntimeConfig().mistralOcr;
    const endpoint = String(providerConfig.baseUrl || runtimeOcr.baseUrl).replace(/\/$/, '');
    const model = String(providerConfig.model || runtimeOcr.model);
    const mime = String(input.mimeType || 'application/octet-stream').toLowerCase();
    const dataUrl = bytesToDataUrl(input.bytes, mime);

    const documentPayload = mime.startsWith('image/')
      ? { type: 'image_url', image_url: dataUrl }
      : { type: 'document_url', document_url: dataUrl };

    const response = await fetch(`${endpoint}/ocr`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        document: documentPayload,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Mistral OCR API error (${response.status}): ${detail || response.statusText}`);
    }

    const payload = (await response.json()) as MistralOcrResponse;
    const pageTexts = (payload.pages || [])
      .map((page) => normalizeText(page.markdown || page.text || ''))
      .filter(Boolean);

    const text = normalizeText(pageTexts.join('\n\n'));
    const quality = scoreQuality(text.length);
    const chunks = splitParagraphAware(text).map((content, idx) => ({
      content,
      tokenCount: estimateTokens(content),
      metadata: {
        source: 'mistral_ocr',
        chunkIndex: idx,
      },
    }));

    return {
      text,
      quality,
      chunks,
      stats: {
        pages: (payload.pages || []).length,
        pagesWithText: pageTexts.length,
        totalChars: text.length,
      },
      source: 'mistral_ocr',
      model: payload.model || model,
    };
  }

  private static async resolveProviderConfig(): Promise<{
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
  }> {
    const now = Date.now();
    if (this.cachedConfig && this.cachedConfig.expiresAt > now) {
      return {
        apiKey: this.cachedConfig.apiKey,
        baseUrl: this.cachedConfig.baseUrl,
        model: this.cachedConfig.model,
      };
    }

    const defaultMistral = await ProviderConfigRepo.findDefaultForProvider('mistral');

    let key: string | null = null;
    let baseUrl: string | null = null;
    let model: string | null = null;

    if (defaultMistral) {
      key = await ProviderConfigRepo.decryptApiKey(defaultMistral);
      baseUrl = defaultMistral.baseUrl || null;
      model = defaultMistral.model || null;
    } else {
      const anyMistral = await ProviderConfigRepo.findFirstForProvider('mistral');
      if (anyMistral) {
        key = await ProviderConfigRepo.decryptApiKey(anyMistral);
        baseUrl = anyMistral.baseUrl || null;
        model = anyMistral.model || null;
      }
    }

    // Fallback to env values when provider config is absent/incomplete.
    const runtimeOcr = getRuntimeConfig().mistralOcr;
    if (!key) {
      key = runtimeOcr.apiKey || null;
    }
    if (!baseUrl) {
      baseUrl = runtimeOcr.baseUrl || null;
    }
    if (!model) {
      model = runtimeOcr.model || null;
    }

    this.cachedConfig = {
      apiKey: key,
      baseUrl,
      model,
      expiresAt: now + 60_000,
    };

    return {
      apiKey: key,
      baseUrl,
      model,
    };
  }
}
