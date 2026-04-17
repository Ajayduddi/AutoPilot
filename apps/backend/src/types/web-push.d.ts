/**
 * @fileoverview types/web-push.d.
 *
 * High-level purpose:
 * Ambient and shared backend type declarations used across runtime modules.
 *
 * Key Features (and trade-offs):
 * - Extends framework/runtime typings for project-specific contracts.
 * - Centralizes declaration merging and shared type surfaces.
 * - Improves compile-time safety for middleware and integrations.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add declarations only for stable shared typing needs.
 * 3. Keep declaration files additive and backwards compatible.
 * 4. Run backend typecheck after type contract updates.
 * 5. Keep documentation aligned with behavior and tests.
 */
declare module 'web-push';

