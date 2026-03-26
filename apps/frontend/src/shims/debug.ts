type DebugFn = ((...args: unknown[]) => void) & {
  enabled: boolean;
  namespace: string;
  extend: (suffix: string) => DebugFn;
};

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
