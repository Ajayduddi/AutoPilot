/**
 * @fileoverview apps/frontend/src/shims/debug.ts
 *
 * High-level purpose:
 * Frontend compatibility shim module used to normalize runtime behavior across bundler/library boundaries.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Provides targeted compatibility adjustments in one place.
 * - Reduces framework-specific workarounds leaking into app code.
 * - Preserves stable behavior for dependent frontend modules.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import shim only where compatibility adaptation is needed.
 * 2. Keep shim scope narrow and document upstream constraints.
 * 3. Retest impacted routes/components after shim changes.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
/**
  * debug fn type alias.
  */
type DebugFn = ((...args: unknown[]) => void) & {
  enabled: boolean;
  namespace: string;
  extend: (suffix: string) => DebugFn;
};

/**
 * Utility function to create debug.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param namespace - Input value for createDebug.
 * @returns Return value from createDebug.
 *
 * @example
 * ```typescript
 * const output = createDebug(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function createDebug(namespace: string): DebugFn {
  const fn = ((..._args: unknown[]) => {}) as DebugFn;
  fn.enabled = false;
  fn.namespace = namespace;
  fn.extend = (suffix: string) => createDebug(`${namespace}:${suffix}`);
  return fn;
}

createDebug.enable = (_namespaces: string) => {};
createDebug.disable = () => "";
createDebug.enabled = (_namespace: string) => false;
createDebug.log = (..._args: unknown[]) => {};
createDebug.formatters = {} as Record<string, (...args: unknown[]) => unknown>;

export default createDebug;
