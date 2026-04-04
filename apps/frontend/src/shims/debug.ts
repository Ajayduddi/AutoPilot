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
