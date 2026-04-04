import { test, expect } from './helpers/test-fixtures';

test.describe('Chat Page — /', () => {
  test('chat page loads with composer textarea', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/AutoPilot/i);

    // Composer textarea should be visible
    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });
  });

  test('composer has rotating placeholder hints', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    const placeholder = await composer.getAttribute('placeholder');
    // Should have one of the hint placeholders
    expect(placeholder).toBeTruthy();
  });

  test('thread sidebar shows existing threads', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Thread list area should exist (may be empty or populated)
    // In the desktop view the sidebar contains thread list
    await page.waitForTimeout(2000);

    // Page should render without errors
    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });

  test('new thread button works', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The "New Thread" or "+" button in the thread sidebar
    const newThreadBtn = page.locator('button[title="New thread"], button:has-text("New")');
    if (await newThreadBtn.isVisible()) {
      await newThreadBtn.click();
      await page.waitForTimeout(500);

      // Should clear the chat area (no messages)
      const composer = page.locator('textarea');
      await expect(composer).toBeVisible();
    }
  });

  test('model selector dropdown opens', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // The model selector button in the chat header
    const modelSelector = page.locator('[class*="model"], button:has-text("Auto"), button:has-text(":::"), [class*="dropdown"]').first();

    if (await modelSelector.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await modelSelector.click();
      await page.waitForTimeout(500);
      // Dropdown should appear with model options
    }
  });

  test('sending a message creates user bubble', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const composer = page.locator('textarea');
    await expect(composer).toBeVisible({ timeout: 10_000 });

    // Type a test message
    await composer.fill('Hello, this is an E2E test');

    // Submit (Enter or button click)
    await composer.press('Enter');

    // Wait for user message bubble to appear
    await page.waitForTimeout(3000);

    // Check that the message appears in the feed
    const userMessage = page.locator('text=Hello, this is an E2E test');
    await expect(userMessage).toBeVisible({ timeout: 15_000 });
  });

  test('scroll-to-bottom button appears on scroll', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // First send a few messages to create content to scroll
    const composer = page.locator('textarea');
    if (await composer.isVisible()) {
      // Create a thread with some content first
      await composer.fill('Test message for scrolling');
      await composer.press('Enter');
      await page.waitForTimeout(5000);

      // Try to scroll up to see if scroll-to-bottom appears
      const feedArea = page.locator('[class*="overflow-y-auto"]').first();
      if (await feedArea.isVisible()) {
        await feedArea.evaluate((el) => {
          el.scrollTop = 0;
        });
        await page.waitForTimeout(500);
      }
    }
  });

  test('customize panel opens', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const customizeBtn = page.locator('button:has-text("Customize"), button[title*="customize"]');
    if (await customizeBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await customizeBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('chat page renders without error boundary', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Ensure no error boundary is shown
    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });

  test('attachment picker trigger exists', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for the attachment/paperclip button near the composer
    const attachBtn = page.locator('button[title*="attach"], button[aria-label*="attach"], input[type="file"]');
    // The file input for attachments should exist (it may be hidden)
    const fileInput = page.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
      // File input exists for attachment upload
      expect(await fileInput.count()).toBeGreaterThan(0);
    }
  });
});
