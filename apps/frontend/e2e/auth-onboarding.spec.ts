/**
 * @fileoverview apps/frontend/e2e/auth-onboarding.spec.ts
 *
 * High-level purpose:
 * Frontend end-to-end test module validating critical user journeys and UI behavior across environments.
 * Business value: helps frontend teams evolve user-facing behavior with
 * predictable module responsibilities and lower integration risk.
 * System impact: this module contributes to frontend runtime correctness,
 * maintainability, and release confidence.
 *
 * Key Features (and trade-offs):
 * - Exercises real browser flows for high-value user scenarios.
 * - Covers cross-feature integration behavior and regressions.
 * - Provides confidence for release readiness of frontend changes.
 * - Trade-off: stronger modular boundaries can require extra composition
 *   plumbing when implementing cross-feature changes.
 *
 * Usage Guide:
 * 1. Set up test fixtures and authenticated state prerequisites.
 * 2. Execute scenario steps using stable selectors and assertions.
 * 3. Run suite locally/CI and refine for deterministic outcomes.
 * 4. Validate behavior with existing frontend lint/type/test workflows.
 * 5. Keep this overview updated when module responsibilities change.
 */
import { test, expect } from './helpers/test-fixtures';

test.describe('Onboarding Page — /onboarding', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('renders onboarding form with all expected elements', async ({ page }) => {
    await page.goto('/onboarding');
    // If redirected to /login (user already exists), skip this test
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    await expect(page).toHaveTitle(/Onboarding.*AutoPilot/i);
    await expect(page.locator('h1')).toContainText('Create account');
    await expect(page.locator('text=Set up the primary owner account')).toBeVisible();

    // Name field (optional)
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await expect(page.locator('text=optional')).toBeVisible();

    // Email field
    await expect(page.locator('input[type="email"]')).toBeVisible();

    // Password fields (2: password + confirm)
    const passwordInputs = page.locator('input[type="password"]');
    await expect(passwordInputs).toHaveCount(2);

    // Submit button
    await expect(page.locator('button[type="submit"]')).toContainText('Create account');
  });

  test('shows error when email is empty', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    await page.click('button[type="submit"]');

    const error = page.locator('text=Email is required');
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('shows error for short password', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    await page.fill('input[type="email"]', 'short@test.com');
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('short');
    await passwordInputs.nth(1).fill('short');
    await page.click('button[type="submit"]');

    const error = page.locator('text=Password must be at least 8 characters');
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('shows error when passwords do not match', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    await page.fill('input[type="email"]', 'mismatch@test.com');
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('Password123!');
    await passwordInputs.nth(1).fill('DifferentPassword!');
    await page.click('button[type="submit"]');

    const error = page.locator('text=Passwords do not match');
    await expect(error).toBeVisible({ timeout: 5_000 });
  });

  test('submit button shows loading state', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    await page.fill('input[type="email"]', 'loading@test.com');
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('TestPassword123!');
    await passwordInputs.nth(1).fill('TestPassword123!');
    await page.click('button[type="submit"]');

    await expect(page.locator('button[type="submit"]')).toContainText('Creating account');
  });

  test('brand icon is rendered on onboarding page', async ({ page }) => {
    await page.goto('/onboarding');
    await page.waitForLoadState('networkidle');
    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    // The edit/pencil icon for onboarding
    const svgIcon = page.locator('svg').first();
    await expect(svgIcon).toBeVisible();
  });
});
