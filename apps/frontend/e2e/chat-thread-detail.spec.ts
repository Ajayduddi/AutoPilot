import { test, expect } from './helpers/test-fixtures';

test.describe('Chat Thread Detail — /threads/:id', () => {
  test('navigating to a valid thread loads messages', async ({ authedPage: page }) => {
    // First create a thread by sending a message from the main chat
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    await composer.fill('Thread detail test message');
    await composer.press('Enter');

    // Wait for thread to be created and URL to update
    await page.waitForURL('**/threads/**', { timeout: 20_000 });

    // The thread detail page should show the sent message
    const sentMessage = page.locator('text=Thread detail test message');
    await expect(sentMessage).toBeVisible({ timeout: 10_000 });

    // URL should contain /threads/ with an ID
    expect(page.url()).toContain('/threads/');
  });

  test('thread detail page shows consistent title', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    await composer.fill('Title test message');
    await composer.press('Enter');
    await page.waitForURL('**/threads/**', { timeout: 20_000 });

    // Title should contain AutoPilot
    await expect(page).toHaveTitle(/AutoPilot/i);
  });

  test('refreshing a thread page preserves messages', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    await composer.fill('Refresh persistence test');
    await composer.press('Enter');
    await page.waitForURL('**/threads/**', { timeout: 20_000 });

    // Save the URL
    const threadUrl = page.url();

    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Message should still be visible after reload
    const message = page.locator('text=Refresh persistence test');
    await expect(message).toBeVisible({ timeout: 15_000 });
  });

  test('composer is available on thread detail page', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    await composer.fill('Composer check');
    await composer.press('Enter');
    await page.waitForURL('**/threads/**', { timeout: 20_000 });

    // Composer should still be visible for follow-up messages
    await expect(page.locator('textarea')).toBeVisible({ timeout: 10_000 });
  });

  test('page renders without error boundary', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    if (await composer.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await composer.fill('Error check test');
      await composer.press('Enter');
      await page.waitForURL('**/threads/**', { timeout: 20_000 });
    }

    // Ensure no crash
    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });
});
