/**
 * @fileoverview apps/backend/src/util/safe-exec.ts
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
export class SafeExecError extends Error {
  readonly command: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;

  constructor(params: {
    message: string;
    command: string;
    exitCode?: number | null;
    stdout?: string;
    stderr?: string;
  }) {
    super(params.message);
    this.name = "SafeExecError";
    this.command = params.command;
    this.exitCode = params.exitCode ?? null;
    this.stdout = params.stdout ?? "";
    this.stderr = params.stderr ?? "";
  }
}

type SafeExecOptions = {
  args?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  cwd?: string;
  allowedCommands?: readonly string[];
};

type SafeExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function assertAllowedCommand(command: string, allowedCommands?: readonly string[]): void {
  if (!allowedCommands || allowedCommands.length === 0) return;
  if (allowedCommands.includes(command)) return;
  throw new SafeExecError({
    message: `Command not allowed: ${command}`,
    command,
  });
}

async function readStreamLimited(
  stream: ReadableStream<Uint8Array> | null,
  limitBytes: number,
  command: string,
  streamName: "stdout" | "stderr",
  process: { kill: () => void },
): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > limitBytes) {
        process.kill();
        throw new SafeExecError({
          message: `${command} exceeded ${streamName} limit of ${limitBytes} bytes`,
          command,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function safeExec(
  command: string,
  options: SafeExecOptions = {},
): Promise<SafeExecResult> {
  assertAllowedCommand(command, options.allowedCommands);

  const args = options.args ?? [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const bunRuntime = (globalThis as {
    Bun?: {
      spawn: (args: string[], options: Record<string, unknown>) => {
        stdout: ReadableStream<Uint8Array> | null;
        stderr: ReadableStream<Uint8Array> | null;
        exited: Promise<number>;
        kill: () => void;
      };
    };
  }).Bun;

  if (!bunRuntime) {
    throw new SafeExecError({
      message: "Bun runtime is required for safeExec",
      command,
    });
  }

  const child = bunRuntime.spawn([command, ...args], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeout = setTimeout(() => {
    child.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      readStreamLimited(child.stdout, maxOutputBytes, command, "stdout", child),
      readStreamLimited(child.stderr, maxOutputBytes, command, "stderr", child),
      child.exited,
    ]);

    if (exitCode !== 0) {
      throw new SafeExecError({
        message: `${command} exited with code ${exitCode}`,
        command,
        exitCode,
        stdout,
        stderr,
      });
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  } catch (error) {
    if (error instanceof SafeExecError) throw error;
    throw new SafeExecError({
      message: error instanceof Error ? error.message : `Failed to execute ${command}`,
      command,
    });
  } finally {
    clearTimeout(timeout);
  }
}
