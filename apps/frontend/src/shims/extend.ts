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
