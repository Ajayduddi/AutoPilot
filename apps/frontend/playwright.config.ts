/**
 * @fileoverview apps/frontend/playwright.config.ts
 *
 * High-level purpose:
 * Frontend configuration module defining runtime/build/test behavior for the application lifecycle.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Centralizes framework and tooling configuration defaults.
 * - Supports environment-specific behavior through typed options.
 * - Improves reproducibility across local and CI execution.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Update configuration values for target environment needs.
 * 2. Keep config changes aligned with scripts and project docs.
 * 3. Validate by running associated frontend build/test commands.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration for AutoPilot frontend.
 *
 * Requires both backend (:3000) and frontend (:5173) dev servers to be running.
 * Start them with `bun run dev` from the workspace root before running tests.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  expect: { timeout: 8_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  outputDir: './e2e-results',
});
