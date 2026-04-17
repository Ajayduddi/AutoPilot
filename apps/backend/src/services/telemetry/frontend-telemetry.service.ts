/**
 * @fileoverview services/telemetry/frontend-telemetry.service.
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
import { logger } from '../../util/logger';
import { incrementCounter } from '../../util/metrics';

export type FrontendTelemetryLevel = 'info' | 'warn' | 'error';

export type FrontendTelemetryInput = {
  level?: unknown;
  category?: unknown;
  message?: unknown;
  metadata?: unknown;
};

export type FrontendTelemetryEvent = {
  level: FrontendTelemetryLevel;
  category: string;
  message: string;
  metadata: Record<string, unknown>;
};

const MAX_CATEGORY_LENGTH = 64;
const MAX_MESSAGE_LENGTH = 240;
const MAX_METADATA_KEYS = 20;
const MAX_STRING_VALUE_LENGTH = 500;
const MAX_ARRAY_ITEMS = 10;

function normalizeString(value: unknown, fallback: string, maxLength: number): string {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeCategory(value: unknown): string {
  const raw = normalizeString(value, 'client_event', MAX_CATEGORY_LENGTH).toLowerCase();
  const normalized = raw.replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'client_event';
}

function normalizeLevel(value: unknown): FrontendTelemetryLevel {
  if (value === 'error' || value === 'warn' || value === 'info') return value;
  return 'info';
}

function normalizeScalar(value: unknown): unknown {
  if (typeof value === 'string') return value.slice(0, MAX_STRING_VALUE_LENGTH);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean' || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeScalar(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') return '[object]';
  if (value === undefined) return undefined;
  return String(value).slice(0, MAX_STRING_VALUE_LENGTH);
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_METADATA_KEYS);
  const metadata: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const key = normalizeCategory(rawKey).replace(/\./g, '_');
    if (!key) continue;
    const normalized = normalizeScalar(rawValue);
    if (normalized !== undefined) metadata[key] = normalized;
  }
  return metadata;
}

export function normalizeFrontendTelemetryEvent(input: FrontendTelemetryInput): FrontendTelemetryEvent {
  const category = normalizeCategory(input.category);
  const message = normalizeString(input.message, category, MAX_MESSAGE_LENGTH);
  return {
    level: normalizeLevel(input.level),
    category,
    message,
    metadata: normalizeMetadata(input.metadata),
  };
}

export function recordFrontendTelemetry(args: {
  userId: string;
  traceId?: string;
  event: FrontendTelemetryEvent;
}): void {
  const { event } = args;
  incrementCounter('autopilot_frontend_telemetry_events_total', {
    category: event.category,
    level: event.level,
  });

  const payload = {
    scope: 'frontend.telemetry',
    message: event.message,
    userId: args.userId,
    traceId: args.traceId,
    category: event.category,
    metadata: event.metadata,
  };

  if (event.level === 'error') {
    logger.error(payload);
    return;
  }
  if (event.level === 'warn') {
    logger.warn(payload);
    return;
  }
  logger.info(payload);
}
