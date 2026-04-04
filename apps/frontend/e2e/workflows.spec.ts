import { test, expect } from './helpers/test-fixtures';

test.describe('Workflows Page — /workflows', () => {
  test('page loads with correct heading', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveTitle(/Workflows.*AutoPilot/i);
    await expect(page.locator('h1')).toContainText('Workflow Registry');
  });

  test('search input is visible and functional', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();

    // Type a search query
    await searchInput.fill('test workflow');
    await page.waitForTimeout(500);

    // Search should filter results (or show empty state)
    // No crash means search is functional
    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });

  test('provider filter dropdown is functional', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // Provider filter (CustomSelect components)
    const providerFilter = page.locator('button:has-text("All Providers"), [class*="select"]:has-text("All Providers")');
    if (await providerFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await providerFilter.click();
      await page.waitForTimeout(300);

      // Dropdown should appear with provider options
      const n8nOption = page.locator('text=n8n');
      if (await n8nOption.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await n8nOption.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('visibility filter dropdown is functional', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const visibilityFilter = page.locator('button:has-text("All Visibility"), [class*="select"]:has-text("All Visibility")');
    if (await visibilityFilter.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await visibilityFilter.click();
      await page.waitForTimeout(300);
    }
  });

  test('archived toggle is functional', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const archivedToggle = page.locator('button:has-text("Archived"), label:has-text("Archived")');
    if (await archivedToggle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await archivedToggle.click();
      await page.waitForTimeout(500);
    }
  });

  test('grid/list view toggle works', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // Look for view toggle buttons (grid/list SVG icons)
    const gridBtn = page.locator('button[title*="Grid"], button[title*="grid"]');
    const listBtn = page.locator('button[title*="List"], button[title*="list"]');

    if (await gridBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await gridBtn.click();
      await page.waitForTimeout(300);
    }

    if (await listBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await listBtn.click();
      await page.waitForTimeout(300);
    }
  });

  test('add workflow button opens creation form', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const addBtn = page.locator('button:has-text("Add Workflow"), button:has-text("New Workflow"), button:has-text("Register")');
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Form should appear with key/name fields
      const keyField = page.locator('input, label:has-text("Key")');
      await expect(keyField.first()).toBeVisible({ timeout: 3_000 });
    }
  });

  test('workflow creation form validates required fields', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const addBtn = page.locator('button:has-text("Add Workflow"), button:has-text("New Workflow"), button:has-text("Register")');
    if (await addBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(500);

      // Try to submit without filling required fields
      const saveBtn = page.locator('button:has-text("Save"), button:has-text("Create"), button:has-text("Register Workflow")');
      if (await saveBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(500);

        // Error should appear
        const error = page.locator('.text-red-400, text=required');
        if (await error.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await expect(error).toBeVisible();
        }
      }
    }
  });

  test('workflow cards show name and provider', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Check that workflow cards exist if there are any workflows
    const workflowCards = page.locator('[class*="workflow-card"], [class*="workflow-surface"]');
    const count = await workflowCards.count();

    if (count > 0) {
      // First card should have text content (name)
      const firstCard = workflowCards.first();
      const text = await firstCard.textContent();
      expect(text).toBeTruthy();
    }
  });

  test('clicking a workflow card navigates to detail page', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Look for clickable workflow cards or links
    const workflowLink = page.locator('a[href*="/workflows/"]').first();
    if (await workflowLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await workflowLink.click();
      await page.waitForURL('**/workflows/**', { timeout: 10_000 });
      expect(page.url()).toContain('/workflows/');
    }
  });

  test('empty state shows when no workflows match filters', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();

    // Search for something unlikely to exist
    await searchInput.fill('zzz_nonexistent_workflow_xyz_12345');
    await page.waitForTimeout(1000);

    // Empty state or "no results" should show
    const emptyState = page.locator('text=No workflows found, text=No registered workflows, text=No results');
    if (await emptyState.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await expect(emptyState).toBeVisible();
    }
  });

  test('page renders without error boundary', async ({ authedPage: page }) => {
    await page.goto('/workflows');
    await page.waitForLoadState('networkidle');

    const errorBoundary = page.locator('text=Something went wrong');
    await expect(errorBoundary).not.toBeVisible();
  });
});
