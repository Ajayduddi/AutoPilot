/**
 * @fileoverview services/attachment-scan.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
 */
import net from "net";
import { logger } from "../util/logger";
import { getRuntimeConfig } from "../config/runtime.config";

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
    const url = String(process.env.ATTACHMENT_SCAN_HTTP_URL || "").trim();
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
        ...(process.env.ATTACHMENT_SCAN_HTTP_TOKEN
          ? { Authorization: `Bearer ${process.env.ATTACHMENT_SCAN_HTTP_TOKEN}` }
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
    const host = String(process.env.CLAMAV_HOST || "127.0.0.1");
    const port = Number(process.env.CLAMAV_PORT || "3310");
    const timeoutMs = getRuntimeConfig().attachmentScan.timeoutMs;

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
            const header = Buffer.alloc(4);
      header.writeUInt32BE(bytes.byteLength, 0);
      socket.write(header);
      socket.write(Buffer.from(bytes));
            const endChunk = Buffer.alloc(4);
      endChunk.writeUInt32BE(0, 0);
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
