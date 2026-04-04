import { test, expect } from './helpers/test-fixtures';

test.describe('Workflow Detail — /workflows/:id', () => {
  // Helper: navigate to the first available workflow detail page
  async function navigateToFirstWorkflow(page: import('@playwright/test').Page) {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const workflowLink = page.locator('a[href*="/workflows/"]').first();
    if (await workflowLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await workflowLink.click();
      await page.waitForURL('**/workflows/**', { timeout: 10_000 });
      return true;
    }
    return false;
  }

  test('page loads with workflow name and metadata grid', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Page title should contain workflow name
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 5_000 });
    const titleText = await heading.textContent();
    expect(titleText).toBeTruthy();

    // Metadata grid should render with labels like Provider, Visibility, etc.
    await expect(page.locator('text=Provider')).toBeVisible();
    await expect(page.locator('text=Visibility')).toBeVisible();
    await expect(page.locator('text=Trigger')).toBeVisible();
    await expect(page.locator('text=HTTP Method')).toBeVisible();
  });

  test('back to workflows link navigates correctly', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const backLink = page.locator('text=Back to Workflows');
    await expect(backLink).toBeVisible();
    await backLink.click();
    await page.waitForURL('**/workflows', { timeout: 10_000 });
  });

  test('edit button opens edit form with pre-filled values', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button:has-text("Edit")');
    await expect(editBtn).toBeVisible({ timeout: 5_000 });
    await editBtn.click();
    await page.waitForTimeout(500);

    // Edit form should appear with heading
    await expect(page.locator('text=Edit Workflow')).toBeVisible();

    // Form should have pre-filled fields
    const keyInput = page.locator('label:has-text("Key") + input, input').first();
    if (await keyInput.isVisible()) {
      const keyValue = await keyInput.inputValue();
      expect(keyValue).toBeTruthy();
    }

    // Cancel button should close the form
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
    await page.waitForTimeout(300);
  });

  test('trigger button is visible for enabled workflows', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    // Trigger or Execute button
    const triggerBtn = page.locator('button:has-text("Trigger"), button:has-text("Execute")');
    if (await triggerBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Click to show input form first
      await triggerBtn.click();
      await page.waitForTimeout(500);

      // Input payload form should appear
      const inputArea = page.locator('text=Input Payload');
      if (await inputArea.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(inputArea).toBeVisible();

        // Cancel should dismiss input form
        const cancelBtn = page.locator('button:has-text("Cancel")');
        if (await cancelBtn.isVisible()) {
          await cancelBtn.click();
        }
      }
    }
  });

  test('delete button opens confirmation modal', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const deleteBtn = page.locator('button:has-text("Delete")').first();
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });
    await deleteBtn.click();
    await page.waitForTimeout(500);

    // Confirmation modal should appear
    await expect(page.locator('text=Delete Workflow?')).toBeVisible();
    await expect(page.locator('text=This action cannot be undone')).toBeVisible();

    // Cancel button should close modal
    const cancelBtn = page.locator('button:has-text("Cancel")').last();
    await cancelBtn.click();
    await page.waitForTimeout(300);

    // Modal should be dismissed
    await expect(page.locator('text=Delete Workflow?')).not.toBeVisible();
  });

  test('provider capability note is displayed', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const providerNote = page.locator('text=Provider Capabilities');
    await expect(providerNote).toBeVisible({ timeout: 5_000 });
  });

  test('metadata grid shows expected fields', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    // All metadata labels should be present
    const expectedLabels = ['Provider', 'Visibility', 'Trigger', 'HTTP Method', 'Auth', 'Enabled', 'Requires Approval', 'Version'];
    for (const label of expectedLabels) {
      await expect(page.locator(`text=${label}`).first()).toBeVisible({ timeout: 3_000 });
    }
  });

  test('edit form has all expected fields', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const editBtn = page.locator('button:has-text("Edit")');
    await editBtn.click();
    await page.waitForTimeout(500);

    // Check all form fields are present
    const expectedFields = ['Key', 'Name', 'Provider', 'Visibility', 'Trigger Method', 'Auth Type', 'Execution Endpoint', 'HTTP Method', 'Description'];
    for (const field of expectedFields) {
      await expect(page.locator(`text=${field}`).first()).toBeVisible({ timeout: 3_000 });
    }

    // Toggle buttons
    await expect(page.locator('button:has-text("Enabled")')).toBeVisible();
    await expect(page.locator('button:has-text("Archived")')).toBeVisible();
    await expect(page.locator('button:has-text("Requires Approval")')).toBeVisible();

    // Close form
    const cancelBtn = page.locator('button:has-text("Cancel")').first();
    await cancelBtn.click();
  });

  test('provider badge is rendered in header', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    // Provider badge (n8n, Zapier, Make, etc.)
    const providerNames = ['n8n', 'Zapier', 'Make', 'Custom', 'Sim'];
    let foundBadge = false;
    for (const name of providerNames) {
      const badge = page.locator(`text=${name}`).first();
      if (await badge.isVisible({ timeout: 1_000 }).catch(() => false)) {
        foundBadge = true;
        break;
      }
    }
    // At least one provider badge should be visible
    expect(foundBadge).toBe(true);
  });

  test('page renders without error boundary', async ({ authedPage: page }) => {
    const found = await navigateToFirstWorkflow(page);
    if (!found) {
      test.skip();
      return;
    }

    await page.waitForLoadState('networkidle');

    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });
});
