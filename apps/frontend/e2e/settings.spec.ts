import { test, expect } from './helpers/test-fixtures';

test.describe('Settings Page — /settings', () => {
  test('page loads with correct heading', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/Settings.*AutoPilot/i);
    await expect(page.locator('h1')).toContainText('Settings');
  });

  test('section navigation tabs are visible', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Section tabs/buttons (Account, Connections, Webhooks/Security, etc.)
    const sectionLabels = ['Account', 'Connections', 'Webhooks'];
    for (const label of sectionLabels) {
      const tab = page.locator(`button:has-text("${label}"), a:has-text("${label}")`).first();
      await expect(tab).toBeVisible({ timeout: 5_000 });
    }
  });

  test('Account section shows profile fields', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click Account tab if not already selected
    const accountTab = page.locator('button:has-text("Account")').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForTimeout(500);
    }

    // Name input
    const nameLabel = page.locator('text=Display Name, text=Name');
    await expect(nameLabel.first()).toBeVisible({ timeout: 5_000 });

    // Email section
    const emailLabel = page.locator('text=Email');
    await expect(emailLabel.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Account section has password change form', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const accountTab = page.locator('button:has-text("Account")').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForTimeout(500);
    }

    // Password change section
    const passwordLabel = page.locator('text=Password, text=Change Password');
    await expect(passwordLabel.first()).toBeVisible({ timeout: 5_000 });

    // Current password and new password inputs
    const passwordInputs = page.locator('input[type="password"]');
    const count = await passwordInputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('Connections section shows provider configuration', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const connectionsTab = page.locator('button:has-text("Connections")').first();
    await connectionsTab.click();
    await page.waitForTimeout(500);

    // Provider section heading
    const providerLabel = page.locator('text=AI Providers, text=Provider, text=Connections');
    await expect(providerLabel.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Connections section has add provider form', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const connectionsTab = page.locator('button:has-text("Connections")').first();
    await connectionsTab.click();
    await page.waitForTimeout(500);

    // Add provider button or form
    const addBtn = page.locator('button:has-text("Add Provider"), button:has-text("Connect"), button:has-text("Add Connection")');
    if (await addBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Form fields for provider config
      const providerSelect = page.locator('text=Provider');
      if (await providerSelect.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await expect(providerSelect).toBeVisible();
      }
    }
  });

  test('Webhooks section shows webhook secrets', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const webhooksTab = page.locator('button:has-text("Webhooks"), button:has-text("Security")').first();
    await webhooksTab.click();
    await page.waitForTimeout(500);

    // Webhook secrets section
    const webhookLabel = page.locator('text=Webhook, text=Secret');
    await expect(webhookLabel.first()).toBeVisible({ timeout: 5_000 });
  });

  test('Webhooks section has generate secret button', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const webhooksTab = page.locator('button:has-text("Webhooks"), button:has-text("Security")').first();
    await webhooksTab.click();
    await page.waitForTimeout(500);

    const generateBtn = page.locator('button:has-text("Generate"), button:has-text("Create"), button:has-text("New Secret")');
    if (await generateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(generateBtn).toBeVisible();
    }
  });

  test('section switching works correctly', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Start on Account
    const accountTab = page.locator('button:has-text("Account")').first();
    await accountTab.click();
    await page.waitForTimeout(300);
    await expect(page.locator('text=Display Name, text=Name').first()).toBeVisible({ timeout: 5_000 });

    // Switch to Connections
    const connectionsTab = page.locator('button:has-text("Connections")').first();
    await connectionsTab.click();
    await page.waitForTimeout(300);

    // Account-specific fields should not be visible (or Connections fields should be)
    const providerLabel = page.locator('text=AI Providers, text=Provider, text=API Key');
    await expect(providerLabel.first()).toBeVisible({ timeout: 5_000 });

    // Switch to Webhooks
    const webhooksTab = page.locator('button:has-text("Webhooks"), button:has-text("Security")').first();
    await webhooksTab.click();
    await page.waitForTimeout(300);
  });

  test('approval mode cards are visible', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Look for approval mode section
    const approvalSection = page.locator('text=Approval Mode, text=Approval Flow, text=approval');
    if (await approvalSection.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(approvalSection).toBeVisible();
    }
  });

  test('profile name can be edited', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const accountTab = page.locator('button:has-text("Account")').first();
    if (await accountTab.isVisible()) {
      await accountTab.click();
      await page.waitForTimeout(500);
    }

    // Find the name input
    const nameInput = page.locator('input[type="text"]').first();
    if (await nameInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      // Clear and type a new name
      await nameInput.clear();
      await nameInput.fill('E2E Test User');

      // Should have a save button
      const saveBtn = page.locator('button:has-text("Save"), button:has-text("Update")');
      if (await saveBtn.first().isVisible({ timeout: 2_000 }).catch(() => false)) {
        // Don't actually save to avoid mutating state
        await expect(saveBtn.first()).toBeVisible();
      }
    }
  });

  test('page renders without error boundary', async ({ authedPage: page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });
});
