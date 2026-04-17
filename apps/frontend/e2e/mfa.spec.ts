/**
 * @fileoverview apps/frontend/e2e/mfa.spec.ts
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

test.describe('MFA User Flows', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login flow handles mfa Required state', async ({ page }) => {
    // Intercept the login call to simulate an MFA requirement
    await page.route('**/api/auth/login', async (route) => {
      if (route.request().method() === 'POST') {
        const body = JSON.parse(route.request().postData() || '{}');
        if (body.email === 'mfa-user@example.com') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: {
                mfaRequired: true,
                method: 'totp',
              },
            }),
          });
          return;
        }
      }
      await route.continue();
    });

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'mfa-user@example.com');
    await page.fill('input[type="password"]', 'Password123!');
    await page.click('button[type="submit"]');

    // Should transition to MFA screen
    await expect(page.locator('text=Second factor required')).toBeVisible();
    await expect(page.locator('input[autocomplete="one-time-code"]')).toBeVisible();
    const verifyBtn = page.locator('button[type="submit"]');
    await expect(verifyBtn).toContainText('Verify code');
  });

  test('settings page shows TOTP setup flow when MFA is disabled', async ({ authedPage: page }) => {
    // Intercept getting the MFA status
    await page.route('**/api/auth/account/mfa', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { enabled: false } }),
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const accountTab = page.locator('button:has-text("Account")').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('text=Multi-Factor Authentication')).toBeVisible();
    await expect(page.locator('text=TOTP is currently disabled')).toBeVisible();

    const setupBtn = page.locator('button:has-text("Set up TOTP MFA")');
    await expect(setupBtn).toBeVisible();

    // Mock the setup endpoint when the button is clicked
    await page.route('**/api/auth/account/mfa/totp/setup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            secret: 'MOCKSECRET123',
            otpauthUri: 'otpauth://totp/mock',
          },
        }),
      });
    });

    await setupBtn.click();

    // Verify the setup UI appears
    await expect(page.locator('text=Finish authenticator setup')).toBeVisible();
    await expect(page.locator('text=MOCKSECRET123')).toBeVisible();
    
    // Verify the code input and enable button
    const authInput = page.locator('input[placeholder="123456"]');
    await expect(authInput).toBeVisible();
    await expect(page.locator('button:has-text("Enable MFA")')).toBeVisible();
  });

  test('settings page shows TOTP disable flow when MFA is enabled', async ({ authedPage: page }) => {
    // Intercept getting the MFA status
    await page.route('**/api/auth/account/mfa', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { enabled: true } }),
      });
    });

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const accountTab = page.locator('button:has-text("Account")').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForTimeout(500);
    }

    await expect(page.locator('text=TOTP MFA is enabled')).toBeVisible();
    
    // Verify inputs for code and password (since E2E Tester has a password)
    const authInput = page.locator('input[placeholder="123456"]');
    await expect(authInput).toBeVisible();
    const passInput = page.locator('input[placeholder="Confirm password"]');
    await expect(passInput).toBeVisible();

    await expect(page.locator('button:has-text("Disable MFA")')).toBeVisible();
  });
});
