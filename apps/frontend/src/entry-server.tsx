/**
 * @fileoverview apps/frontend/src/entry-server.tsx
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
import { createHandler, StartServer } from "@solidjs/start/server";

export default createHandler(() => (
  <StartServer
    document={({ assets, children, scripts }) => (
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>AutoPilot</title>
          <link rel="icon" type="image/svg+xml" href="/icons/icon-192.svg" />
          <link rel="apple-touch-icon" href="/icons/icon-192.svg" />
          {assets}
        </head>
        <body>
          <div id="app">{children}</div>
          {scripts}
        </body>
      </html>
    )}
  />
));
