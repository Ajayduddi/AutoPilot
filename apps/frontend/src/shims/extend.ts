/**
 * @fileoverview apps/frontend/src/shims/extend.ts
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
  * plain object type alias.
  */
type PlainObject = Record<string, unknown>;
const isObject = (value: unknown): value is PlainObject =>
  Object.prototype.toString.call(value) === "[object Object]";
const cloneValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isObject(value)) {
    const out: PlainObject = {};
    for (const key of Object.keys(value)) out[key] = cloneValue(value[key]);
    return out;
  }
  return value;
};
const mergeInto = (target: PlainObject, source: PlainObject, deep: boolean): PlainObject => {
  for (const key of Object.keys(source)) {
    const value = source[key];

    if (deep && Array.isArray(value)) {
      target[key] = value.map(cloneValue);
      continue;
    }

    if (deep && isObject(value)) {
      const base = isObject(target[key]) ? (target[key] as PlainObject) : {};
      target[key] = mergeInto(base, value, true);
      continue;
    }

    target[key] = value;
  }

  return target;
};

/**
 * Utility function to extend.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param ...args - Input value for extend.
 * @returns Return value from extend.
 *
 * @example
 * ```typescript
 * const output = extend(value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function extend(...args: unknown[]): PlainObject {
  let deep = false;
  let index = 0;

  if (typeof args[0] === "boolean") {
    deep = args[0] as boolean;
    index = 1;
  }
  const target = (args[index] && isObject(args[index]) ? args[index] : {}) as PlainObject;
  index += 1;

  for (; index < args.length; index += 1) {
    const source = args[index];
    if (!isObject(source)) continue;
    mergeInto(target, source, deep);
  }

  return target;
}

export default extend;
