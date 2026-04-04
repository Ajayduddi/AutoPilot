/**
 * @fileoverview util/thread-id.
 *
 * Shared utility helpers for logging, metrics, safety checks, and identifiers.
 */
import { randomUUID } from 'crypto';
/**
 * Generates a stable thread identifier prefixing a UUID with `thread_`.
 *
 * @returns Unique thread identifier suitable for persistence and tracing.
 *
 * @example
 * ```typescript
 * const threadId = generateThreadId();
 * // "thread_2d2f6ca1-9d5e-4f48-936f-1f26f7f6a65f"
 * ```
 */
export function generateThreadId(): string {
  return `thread_${randomUUID()}`;
}
