/**
 * @fileoverview services/temporal.service.
 *
 * Deterministic date/time intent detection and timezone-aware response formatting.
 */
import { getRuntimeConfig } from "../config/runtime.config";

type TemporalAnswerKind = 'date' | 'time' | 'datetime' | 'day' | 'relative_date';

/**
 * TemporalResolutionInput type alias.
 */
export type TemporalResolutionInput = {
  profileTimezone?: string | null;
  headerTimezone?: string | null;
};

/**
 * TemporalAnswer type alias.
 */
export type TemporalAnswer = {
    detected: boolean;
  kind?: TemporalAnswerKind;
  text?: string;
  iso?: string;
  timezoneUsed?: string;
  source?: 'deterministic_clock';
  generatedAt?: string;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isValidTimezone(value?: string | null): value is string {
  if (!value || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function resolveTimezone(input: TemporalResolutionInput): string {
    const defaultTimezone = getRuntimeConfig().defaultTimezone;
  if (isValidTimezone(input.profileTimezone)) return input.profileTimezone!.trim();
  if (isValidTimezone(input.headerTimezone)) return input.headerTimezone!.trim();
  if (isValidTimezone(defaultTimezone)) return defaultTimezone.trim();
  return 'UTC';
}

function formatDateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function formatDayInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(date);
}

function formatTimeInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(date);
}

function detectRelativeDays(message: string): number | null {
  if (/\btomorrow\b/.test(message)) return 1;
  if (/\byesterday\b/.test(message)) return -1;

    const nextMatch = message.match(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (nextMatch) {
        const nowDay = new Date().getDay();
        const target = WEEKDAY_INDEX[nextMatch[1]];
        const diff = ((target - nowDay + 7) % 7) || 7;
    return diff;
  }

    const lastMatch = message.match(/\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (lastMatch) {
        const nowDay = new Date().getDay();
        const target = WEEKDAY_INDEX[lastMatch[1]];
        const diff = ((nowDay - target + 7) % 7) || 7;
    return -diff;
  }

  return null;
}

function isTemporalQuery(message: string): boolean {
    const m = normalizeWhitespace(message);
  return (
    /\b(today|date|time|day|tomorrow|yesterday|current time|current date|what day|now)\b/.test(m) ||
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(m) ||
    /\blast\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(m)
  );
}

function inferKind(message: string): TemporalAnswerKind {
    const m = normalizeWhitespace(message);
    const hasDate = /\b(date|today|tomorrow|yesterday|next|last)\b/.test(m);
    const hasTime = /\b(time|now|current time)\b/.test(m);
    const hasDay = /\b(what day|day of week|which day|weekday)\b/.test(m);
    const rel = detectRelativeDays(m);

  if (rel !== null) return 'relative_date';
  if (hasDate && hasTime) return 'datetime';
  if (hasTime) return 'time';
  if (hasDay) return 'day';
  return 'date';
}

/**
 * TemporalService class.
 *
 * Encapsulates temporal service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class TemporalService {
    static validateTimezone(value?: string | null): string | null {
    if (!value) return null;
        const v = value.trim();
    if (!v) return null;
    return isValidTimezone(v) ? v : null;
  }

    static answerIfTemporal(message: string, input: TemporalResolutionInput): TemporalAnswer {
    if (!isTemporalQuery(message)) return { detected: false };

        const timezone = resolveTimezone(input);
        const now = new Date();
        const kind = inferKind(message);
        const relativeDays = detectRelativeDays(normalizeWhitespace(message));
        const target = relativeDays === null
      ? now
      : new Date(now.getTime() + relativeDays * 24 * 60 * 60 * 1000);

        let text: string;
    if (kind === 'time') {
      text = `Current time in ${timezone} is ${formatTimeInTimezone(now, timezone)}.`;
    } else if (kind === 'day') {
      text = `Today in ${timezone} is ${formatDayInTimezone(now, timezone)}.`;
    } else if (kind === 'datetime') {
      text = `Current date and time in ${timezone}: ${formatDateInTimezone(now, timezone)}, ${formatTimeInTimezone(now, timezone)}.`;
    } else if (kind === 'relative_date' && relativeDays !== null) {
      if (relativeDays === 1) {
        text = `Tomorrow's date in ${timezone} is ${formatDateInTimezone(target, timezone)}.`;
      } else if (relativeDays === -1) {
        text = `Yesterday's date in ${timezone} was ${formatDateInTimezone(target, timezone)}.`;
      } else if (relativeDays > 1) {
        text = `That date in ${timezone} is ${formatDateInTimezone(target, timezone)}.`;
      } else {
        text = `That date in ${timezone} was ${formatDateInTimezone(target, timezone)}.`;
      }
    } else {
      text = `Today's date in ${timezone} is ${formatDateInTimezone(now, timezone)}.`;
    }

    return {
      detected: true,
      kind,
      text,
      iso: now.toISOString(),
      timezoneUsed: timezone,
      source: 'deterministic_clock',
      generatedAt: now.toISOString(),
    };
  }
}
