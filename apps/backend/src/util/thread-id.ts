/**
 * @fileoverview util/thread-id.
 *
 * High-level purpose:
 * Shared backend utilities for operational concerns and low-level helpers.
 *
 * Key Features (and trade-offs):
 * - Encapsulates reusable helper logic for runtime infrastructure.
 * - Supports observability, networking, and internal mechanics.
 * - Avoids duplication of common platform helper behavior.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Use utility helpers where cross-domain reuse is needed.
 * 3. Keep helpers side-effect-light and composable.
 * 4. Verify callers after utility contract changes.
 * 5. Keep documentation aligned with behavior and tests.
 */
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
  return `thread_${crypto.randomUUID()}`;
}
