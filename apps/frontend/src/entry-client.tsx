/**
 * @fileoverview apps/frontend/src/entry-client.tsx
 *
 * High-level purpose:
 * Frontend module supporting application runtime behavior, user experience, or development workflow reliability.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Defines typed module contracts for predictable frontend behavior.
 * - Improves maintainability through explicit module responsibilities.
 * - Supports integration with routes, components, and shared utilities.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Import and compose this module through frontend boundaries.
 * 2. Wire module outputs to consumers with typed interfaces.
 * 3. Validate behavior through corresponding frontend tests.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
// @refresh reload
import { mount, StartClient } from "@solidjs/start/client";
import {
  reportRuntimeDebug,
  reportRuntimeError,
  reportRuntimeInfo,
} from "./lib/runtime-reporter";
let mountResult: unknown;

/**
 * Utility function to show runtime banner.
 *
 * @remarks
 * Frontend utility used by the web app UI.
 * @param prefix - Input value for showRuntimeBanner.
 * @param message - Input value for showRuntimeBanner.
 * @returns Return value from showRuntimeBanner.
 *
 * @example
 * ```typescript
 * const output = showRuntimeBanner(value, value);
 * console.log(output);
 * ```
 * @throws {Error} Propagates runtime failures from dependent operations.
 */
function showRuntimeBanner(prefix: string, message: string) {
  const banner = document.createElement("div");
  banner.style.position = "fixed";
  banner.style.left = "12px";
  banner.style.bottom = "12px";
  banner.style.zIndex = "9999";
  banner.style.background = "#7f1d1d";
  banner.style.color = "#fef2f2";
  banner.style.border = "1px solid #dc2626";
  banner.style.padding = "8px 12px";
  banner.style.borderRadius = "8px";
  banner.style.font = "12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace";
  banner.style.maxWidth = "80vw";
  banner.style.whiteSpace = "pre-wrap";
  banner.textContent = `${prefix} ${message}`;
  document.body.appendChild(banner);
}

window.addEventListener("error", (event) => {
  const msg = event.error instanceof Error ? event.error.message : String(event.message || "Unknown error");
  reportRuntimeError("[Runtime error]", event.error || event.message);
  showRuntimeBanner("[Runtime error]", msg);
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
  reportRuntimeError("[Unhandled rejection]", event.reason);
  showRuntimeBanner("[Unhandled rejection]", reason);
});

try {
  const appRoot = document.getElementById("app");
  if (!appRoot) throw new Error("Missing #app root element");

  document.documentElement.setAttribute("data-client-bootstrap", "mounting");
  mountResult = mount(() => <StartClient />, appRoot);
  document.documentElement.setAttribute("data-client-bootstrap", "mounted");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  document.documentElement.setAttribute("data-client-bootstrap", `error:${message}`);
  reportRuntimeError("[Client bootstrap failed]", error);

  // Render a visible fallback when startup crashes before app mount.
  showRuntimeBanner("[Client bootstrap failed]", message);
}

// Register/unregister service worker after mount so SW issues never block UI render.
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  Promise.resolve().then(() => {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").then(
        (registration) => {
          reportRuntimeInfo("[SW] Registered:", registration.scope);
          registration.addEventListener("updatefound", () => {
            const installing = registration.installing;
            if (!installing) return;
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                installing.postMessage({ type: "SKIP_WAITING" });
              }
            });
          });
          navigator.serviceWorker.addEventListener("message", (event) => {
            const type = event.data?.type;
            if (type === "SW_QUEUE_EVENT") {
              reportRuntimeInfo("[SW queue]", event.data?.payload);
            } else if (type === "SW_STATS") {
              reportRuntimeDebug("[SW stats]", event.data?.payload);
            }
          });
          navigator.serviceWorker.ready
            .then(() => navigator.serviceWorker.controller?.postMessage({ type: "GET_SW_STATS" }))
            .catch(() => {});
          window.addEventListener("online", () => {
            navigator.serviceWorker.controller?.postMessage({ type: "RETRY_QUEUED_REQUESTS" });
          });
        },
        (err) => reportRuntimeError("[SW] Registration failed:", err)
      );
    });
  }).catch((err) => reportRuntimeError("[SW] Setup failed:", err));
}

export default mountResult;
