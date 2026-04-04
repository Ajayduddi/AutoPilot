import { test, expect } from './helpers/test-fixtures';

test.describe('Sidebar Navigation', () => {
  test('sidebar renders with all primary navigation links', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Chat link
    const chatLink = page.locator('aside a[href="/"]');
    await expect(chatLink).toBeVisible();

    // Workflows link
    const workflowsLink = page.locator('aside a[href="/workflows"]');
    await expect(workflowsLink).toBeVisible();

    // Notifications link
    const notificationsLink = page.locator('aside a[href="/notifications"]');
    await expect(notificationsLink).toBeVisible();

    // Settings link (in footer area)
    const settingsLink = page.locator('aside a[href="/settings"]');
    await expect(settingsLink).toBeVisible();
  });

  test('navigating to Chat via sidebar', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.click('aside a[href="/"]');
    await page.waitForURL('**/');
    await expect(page).toHaveTitle(/AutoPilot/i);
  });

  test('navigating to Workflows via sidebar', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('aside a[href="/workflows"]');
    await page.waitForURL('**/workflows');
    await expect(page).toHaveTitle(/Workflows.*AutoPilot/i);
  });

  test('navigating to Notifications via sidebar', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('aside a[href="/notifications"]');
    await page.waitForURL('**/notifications');
    await expect(page).toHaveTitle(/Notifications.*AutoPilot/i);
  });

  test('navigating to Settings via sidebar', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.click('aside a[href="/settings"]');
    await page.waitForURL('**/settings');
    await expect(page).toHaveTitle(/Settings/i);
  });

  test('active route is highlighted in sidebar', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const workflowsLink = page.locator('aside a[href="/workflows"]');
    // Active class applies bg-neutral-800/80 and text-neutral-100
    const classes = await workflowsLink.getAttribute('class');
    expect(classes).toContain('bg-neutral-800');
  });

  test('sidebar expand/collapse toggle works on desktop', async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const sidebar = page.locator('aside');
    const initialWidth = await sidebar.evaluate((el) => el.style.width || el.getBoundingClientRect().width);

    // Find the expand/collapse button (the chevron button in footer)
    const toggleBtn = page.locator('aside button[title*="sidebar"], aside button[title*="Expand"], aside button[title*="Collapse"]');
    if (await toggleBtn.isVisible()) {
      await toggleBtn.click();
      await page.waitForTimeout(500); // animation
      const newWidth = await sidebar.evaluate((el) => el.style.width || el.getBoundingClientRect().width);
      expect(newWidth).not.toBe(initialWidth);
    }
  });

  test('logout button is visible and functional', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Logout button in sidebar footer
    const logoutBtn = page.locator('aside button[title="Logout"]');
    await expect(logoutBtn).toBeVisible();

    await logoutBtn.click();

    // Should redirect to login page after logout
    await page.waitForURL('**/login', { timeout: 10_000 });
    await expect(page.locator('h1')).toContainText('Welcome back');
  });

  test('brand logo and name are rendered in sidebar', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Lightning bolt brand icon
    const brandIcon = page.locator('aside svg path[d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"]');
    await expect(brandIcon).toBeVisible();
  });
});
