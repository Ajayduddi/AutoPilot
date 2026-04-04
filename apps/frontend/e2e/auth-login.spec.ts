import { test, expect } from './helpers/test-fixtures';

test.describe('Login Page — /login', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cookies to ensure unauthenticated state
    await page.context().clearCookies();
  });

  test('renders login form with all expected elements', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // Page title
    await expect(page).toHaveTitle(/Login.*AutoPilot/i);

    // Heading
    await expect(page.locator('h1')).toContainText('Welcome back');

    // Subtitle
    await expect(page.locator('text=Sign in to continue')).toBeVisible();

    // Email input
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('placeholder', /example/i);

    // Password input
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput).toBeVisible();

    // Submit button
    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Sign in');
  });

  test('shows validation error when submitting empty form', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.click('button[type="submit"]');

    // Should show error message
    const errorMsg = page.locator('text=Email and password are required');
    await expect(errorMsg).toBeVisible({ timeout: 5_000 });
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'wrong@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"]');

    // Button text changes to "Signing in..." during submission
    await expect(page.locator('button[type="submit"]')).toContainText('Signing in');

    // Error message should appear after failed attempt
    const errorArea = page.locator('.text-red-400');
    await expect(errorArea).toBeVisible({ timeout: 10_000 });
  });

  test('submit button shows loading state during submission', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await page.fill('input[type="email"]', 'test@example.com');
    await page.fill('input[type="password"]', 'testpassword');

    // Click and immediately check loading state
    await page.click('button[type="submit"]');
    await expect(page.locator('button[type="submit"]')).toContainText('Signing in');
  });

  test('displays OAuth error from URL params', async ({ page }) => {
    await page.goto('/login?error=single_user_locked');
    await page.waitForLoadState('networkidle');

    const errorText = page.locator('text=locked to the first onboarded account');
    await expect(errorText).toBeVisible({ timeout: 5_000 });
  });

  test('displays Google auth error from URL params', async ({ page }) => {
    await page.goto('/login?error=google_auth_failed');
    await page.waitForLoadState('networkidle');

    const errorText = page.locator('text=Google authentication failed');
    await expect(errorText).toBeVisible({ timeout: 5_000 });
  });

  test('displays invalid OAuth state error', async ({ page }) => {
    await page.goto('/login?error=invalid_oauth_state');
    await page.waitForLoadState('networkidle');

    const errorText = page.locator('text=OAuth session expired');
    await expect(errorText).toBeVisible({ timeout: 5_000 });
  });

  test('email label is present', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('label:has-text("Email")')).toBeVisible();
  });

  test('password label is present', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('label:has-text("Password")')).toBeVisible();
  });

  test('brand logo icon is rendered', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    // The lightning bolt SVG icon
    const svgIcon = page.locator('svg path[d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"]');
    await expect(svgIcon).toBeVisible();
  });
});
