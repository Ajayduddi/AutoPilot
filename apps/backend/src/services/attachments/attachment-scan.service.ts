/**
 * @fileoverview services/attachment-scan.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import net from "net";
import { logger } from "../../util/logger";
import { getRuntimeConfig } from "../../config/runtime.config";

function createUint32BigEndian(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

type ScanResult =
  | { status: "skipped"; reason: string }
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | { status: "error"; reason: string };

function isEnabled(): boolean {
    const mode = getRuntimeConfig().attachmentScan.mode;
  return mode === "clamav" || mode === "http";
}

function failClosed(): boolean {
  return getRuntimeConfig().attachmentScan.failClosed;
}

async function scanWithHttp(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ScanResult> {
    const scanConfig = getRuntimeConfig().attachmentScan;
    const url = String(scanConfig.httpUrl || "").trim();
  if (!url) return { status: "skipped", reason: "ATTACHMENT_SCAN_HTTP_URL not configured" };
    const payload = new Uint8Array(input.bytes.byteLength);
  payload.set(input.bytes);
  try {
        const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-file-name": input.filename,
        "x-mime-type": input.mimeType,
        ...(scanConfig.httpToken
          ? { Authorization: `Bearer ${scanConfig.httpToken}` }
          : {}),
      },
      body: payload.buffer,
      signal: AbortSignal.timeout(getRuntimeConfig().attachmentScan.timeoutMs),
    });
    if (!response.ok) return { status: "error", reason: `scanner_http_${response.status}` };
        const json = await response.json().catch(() => ({} as any));
    if (json?.status === "infected") return { status: "infected", signature: String(json.signature || "malware_detected") };
    return { status: "clean" };
  } catch (err: any) {
    return { status: "error", reason: err?.message || "scanner_http_failed" };
  }
}

async function scanWithClamAv(input: { bytes: Uint8Array }): Promise<ScanResult> {
    const scanConfig = getRuntimeConfig().attachmentScan;
    const host = scanConfig.clamavHost;
    const port = scanConfig.clamavPort;
    const timeoutMs = scanConfig.timeoutMs;

  return await new Promise<ScanResult>((resolve) => {
        const socket = net.createConnection({ host, port });
        const timeout = setTimeout(() => {
      socket.destroy();
      resolve({ status: "error", reason: "clamav_timeout" });
    }, timeoutMs);

        let response = "";
    socket.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ status: "error", reason: err.message || "clamav_connection_error" });
    });

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });

    socket.on("end", () => {
      clearTimeout(timeout);
            const text = response.trim();
            const infected = text.match(/FOUND$/i);
      if (infected) {
                const sig = text.replace(/^stream:\s*/i, "").replace(/\s+FOUND$/i, "").trim() || "malware_detected";
        resolve({ status: "infected", signature: sig });
      } else if (/OK$/i.test(text)) {
        resolve({ status: "clean" });
      } else {
        resolve({ status: "error", reason: text || "clamav_unknown_response" });
      }
    });

    socket.on("connect", () => {
            const bytes = input.bytes;
      socket.write("zINSTREAM\0");
            const header = createUint32BigEndian(bytes.byteLength);
      socket.write(header);
      socket.write(bytes);
            const endChunk = createUint32BigEndian(0);
      socket.write(endChunk);
    });
  });
}

/**
 * AttachmentScanService class.
 *
 * Encapsulates attachment scan service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AttachmentScanService {
  static async scan(input: { filename: string; mimeType: string; bytes: Uint8Array }): Promise<ScanResult> {
    if (!isEnabled()) return { status: "skipped", reason: "scan_disabled" };
        const mode = getRuntimeConfig().attachmentScan.mode;
        const result = mode === "http" ? await scanWithHttp(input) : await scanWithClamAv({ bytes: input.bytes });
    if (result.status === "error") {
      logger.warn({
        scope: "attachment.scan",
        message: "Attachment scan error",
        reason: result.reason,
        filename: input.filename,
      });
    }
    if (result.status === "infected") {
      logger.warn({
        scope: "attachment.scan",
        message: "Attachment infected",
        filename: input.filename,
        signature: result.signature,
      });
    }
    return result;
  }

    static shouldBlockOnScanError(): boolean {
    return failClosed();
  }
}
