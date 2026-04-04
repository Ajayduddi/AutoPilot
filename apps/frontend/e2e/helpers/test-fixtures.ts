import { test as base, expect, type Page } from '@playwright/test';

// ─── Test user credentials ──────────────────────────────────────────────────
export const TEST_USER = {
  name: 'E2E Tester',
  email: 'e2e-test@autopilot.local',
  password: 'Test1234!secure',
};

const API_BASE = process.env.E2E_API_URL || 'http://localhost:3000';

// ─── API helpers ────────────────────────────────────────────────────────────

/** Raw fetch wrapper against the backend API with cookie auth. */
async function apiRequest(
  path: string,
  options?: RequestInit & { cookies?: string },
): Promise<{ status: number; data: any; headers: Headers }> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options?.cookies ? { Cookie: options.cookies } : {}),
      ...((options?.headers as Record<string, string>) || {}),
    },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, data: json.data ?? json, headers: res.headers };
}

/** Check the current auth state of the backend to decide setup strategy. */
export async function getAuthState(): Promise<{ mode: string }> {
  const { data } = await apiRequest('/api/auth/state');
  return data;
}

// ─── Page helpers ───────────────────────────────────────────────────────────

/**
 * Log in via the UI login form.
 * Assumes the page is already at `/login` or will be redirected there.
 */
export async function loginViaUI(
  page: Page,
  email = TEST_USER.email,
  password = TEST_USER.password,
) {
  await page.goto('/login');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  // Wait for redirect away from login
  await page.waitForURL((url) => !url.pathname.includes('/login'), {
    timeout: 15_000,
  });
}

/**
 * Onboard a test user via the UI onboarding form.
 * Only runs when the backend is in "onboarding" mode.
 */
export async function onboardViaUI(page: Page) {
  await page.goto('/onboarding');
  await page.waitForSelector('input[type="email"]', { timeout: 10_000 });

  const nameInput = page.locator('input[type="text"]').first();
  if (await nameInput.isVisible()) {
    await nameInput.fill(TEST_USER.name);
  }

  await page.fill('input[type="email"]', TEST_USER.email);

  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill(TEST_USER.password);
  await passwordInputs.nth(1).fill(TEST_USER.password);

  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.includes('/onboarding'), {
    timeout: 15_000,
  });
}

/**
 * Ensure the test user is authenticated.
 * Handles onboarding if the backend is fresh, or login if a user exists.
 */
export async function ensureAuthenticated(page: Page) {
  await page.goto('/');
  // The RootShell will redirect to /login or /onboarding based on auth state
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  if (currentUrl.includes('/onboarding')) {
    await onboardViaUI(page);
  } else if (currentUrl.includes('/login')) {
    await loginViaUI(page);
  }
  // If neither, we're already authenticated
}

/**
 * Navigate to a route, ensuring user is authenticated first.
 */
export async function navigateAuthenticated(page: Page, path: string) {
  await ensureAuthenticated(page);
  if (!page.url().endsWith(path)) {
    await page.goto(path);
  }
  await page.waitForLoadState('networkidle');
}

// ─── Custom test fixture with authenticated page ────────────────────────────

type AuthFixtures = {
  /** A Page that has already been authenticated (logged in). */
  authedPage: Page;
};

export const test = base.extend<AuthFixtures>({
  authedPage: async ({ page }, use) => {
    await ensureAuthenticated(page);
    await use(page);
  },
});

export { expect };
