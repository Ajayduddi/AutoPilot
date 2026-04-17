/**
 * @fileoverview apps/frontend/e2e/chat-thread-detail.spec.ts
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

test.describe('Chat Thread Detail — /threads/:id', () => {
  test('renders seeded long-form assistant markdown with stable sections and bullets', async ({ page }) => {
    const threadId = 'thread_render_regression';

    await page.route('**/api/auth/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: {
            mode: 'authenticated',
            user: { id: 'user_e2e', email: 'e2e-test@autopilot.local', name: 'E2E Tester' },
            oauth: { google: false },
          },
        }),
      });
    });

    await page.route('**/api/settings/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/workflows**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/chat/threads', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: threadId,
              userId: 'user_e2e',
              title: 'Render regression thread',
              createdAt: '2026-04-10T00:00:00.000Z',
              updatedAt: '2026-04-10T00:00:00.000Z',
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/messages**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: 'msg_user_render',
              threadId,
              role: 'user',
              content: 'what can u do for me',
              createdAt: '2026-04-10T00:00:00.000Z',
            },
            {
              id: 'msg_assistant_render',
              threadId,
              role: 'assistant',
              content: "Here's what I can do for you right now:",
              createdAt: '2026-04-10T00:00:01.000Z',
              blocks: {
                blocks: [
                  {
                    type: 'summary',
                    items: ['Main agent handled this as direct chat response (no subagent execution).'],
                  },
                  {
                    type: 'markdown',
                    text: [
                      "Here's what I can do for you right now:",
                      "",
                      "🔧 Immediate Actions",
                      "• Profile & Portfolio - Fetch your personal details, projects, and experience.",
                      "• Leetcode Stats - Check solved problems (Easy/Medium/Hard).",
                      "• Social Links - Provide direct links to your profiles.",
                      "",
                      "📌 Other Helpers",
                      "📝 Resume/CV Review - Analyze and suggest improvements. 💡 Project Ideas - Suggest next steps for your portfolio. 🔍 Job/Internship Search - Help refine your search or draft applications.",
                    ].join('\n'),
                  },
                ],
              },
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/memory-insights**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [],
          meta: {
            total: 0,
            limit: 1,
            category: 'all',
            groupBy: 'category',
            groupedCounts: {},
          },
        }),
      });
    });

    await page.goto(`/threads/${threadId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Immediate Actions')).toBeVisible();
    await expect(page.locator('text=Other Helpers')).toBeVisible();

    const assistantLists = page.locator('.assistant-message .markdown-body ul');
    await expect(assistantLists.first()).toBeVisible();

    const listItems = page.locator('.assistant-message .markdown-body li');
    await expect(listItems.filter({ hasText: 'Profile & Portfolio' })).toHaveCount(1);
    await expect(listItems.filter({ hasText: 'Resume/CV Review' })).toHaveCount(1);
    await expect(listItems.filter({ hasText: 'Project Ideas' })).toHaveCount(1);
    await expect(listItems.filter({ hasText: 'Job/Internship Search' })).toHaveCount(1);
  });

  test('renders seeded review-style assistant markdown with stable sections and verdict spacing', async ({ page }) => {
    const threadId = 'thread_review_render_regression';

    await page.route('**/api/auth/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: {
            mode: 'authenticated',
            user: { id: 'user_e2e', email: 'e2e-test@autopilot.local', name: 'E2E Tester' },
            oauth: { google: false },
          },
        }),
      });
    });

    await page.route('**/api/settings/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/workflows**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/chat/threads', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: threadId,
              userId: 'user_e2e',
              title: 'Review render regression thread',
              createdAt: '2026-04-10T00:00:00.000Z',
              updatedAt: '2026-04-10T00:00:00.000Z',
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/messages**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: 'msg_user_review',
              threadId,
              role: 'user',
              content: 'can u rate my profile',
              createdAt: '2026-04-10T00:00:00.000Z',
            },
            {
              id: 'msg_assistant_review',
              threadId,
              role: 'assistant',
              content: 'Profile Rating: 9.2/10',
              createdAt: '2026-04-10T00:00:01.000Z',
              blocks: {
                blocks: [
                  {
                    type: 'summary',
                    items: ['Main agent handled this as a direct chat response (no subagent execution).'],
                  },
                  {
                    type: 'markdown',
                    text: [
                      'Profile Rating: 9.2/10',
                      'Key Strengths (9.2/10)',
                      '✅ Technical Depth (9.5/10) - Strong React, backend, and product experience.',
                      '✅ Problem-Solving (9/10) - Strong algorithmic track record.',
                      'Areas for Improvement (8/10)',
                      '🔹 Open-Source Contributions - Limited public activity.',
                      '🔹 Certifications - Could be stronger for cloud/platform roles.',
                      'Final Verdict',
                      'Strong full-stack profile with room to grow in public technical proof.',
                      'Next Steps: 🚀 Contribute to open-source. 📝 Publish technical blogs. 💡 Build one polished flagship case study.',
                    ].join('\n'),
                  },
                ],
              },
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/memory-insights**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [],
          meta: {
            total: 0,
            limit: 1,
            category: 'all',
            groupBy: 'category',
            groupedCounts: {},
          },
        }),
      });
    });

    await page.goto(`/threads/${threadId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Key Strengths')).toBeVisible();
    await expect(page.locator('text=Areas for Improvement')).toBeVisible();
    await expect(page.locator('text=Final Verdict')).toBeVisible();
    await expect(page.locator('text=Next Steps')).toBeVisible();

    const listItems = page.locator('.assistant-message .markdown-body li');
    await expect(listItems.filter({ hasText: 'Technical Depth' })).toHaveCount(1);
    await expect(listItems.filter({ hasText: 'Open-Source Contributions' })).toHaveCount(1);
    await expect(listItems.filter({ hasText: 'Contribute to open-source' })).toHaveCount(1);
    await expect(page.locator('.assistant-message .markdown-body p', { hasText: 'Strong full-stack profile with room to grow in public technical proof.' })).toBeVisible();
  });

  test('renders seeded interactive-question flow with markdown context and options', async ({ page }) => {
    const threadId = 'thread_question_render_regression';

    await page.route('**/api/auth/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: {
            mode: 'authenticated',
            user: { id: 'user_e2e', email: 'e2e-test@autopilot.local', name: 'E2E Tester' },
            oauth: { google: false },
          },
        }),
      });
    });

    await page.route('**/api/settings/providers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/workflows**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', data: [] }),
      });
    });

    await page.route('**/api/chat/threads', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: threadId,
              userId: 'user_e2e',
              title: 'Interactive question render regression thread',
              createdAt: '2026-04-10T00:00:00.000Z',
              updatedAt: '2026-04-10T00:00:00.000Z',
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/messages**`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [
            {
              id: 'msg_user_question',
              threadId,
              role: 'user',
              content: 'help me improve my profile',
              createdAt: '2026-04-10T00:00:00.000Z',
            },
            {
              id: 'msg_assistant_question',
              threadId,
              role: 'assistant',
              content: 'You have a strong base profile overall.',
              createdAt: '2026-04-10T00:00:01.000Z',
              blocks: {
                blocks: [
                  {
                    type: 'summary',
                    items: ['Main agent handled this as a direct chat response (no subagent execution).'],
                  },
                  {
                    type: 'markdown',
                    text: 'You have a strong base profile overall.',
                  },
                  {
                    type: 'question_mcq',
                    questionId: 'q_profile_followup',
                    prompt: 'Choose how you want to continue:',
                    options: [
                      { id: 'resume', label: 'Resume tweak', valueToSend: 'resume tweak', recommended: true },
                      { id: 'linkedin', label: 'LinkedIn optimization tip', valueToSend: 'linkedin optimization tip' },
                      { id: 'both', label: 'Both', valueToSend: 'both' },
                    ],
                  },
                  {
                    type: 'source',
                    origin: 'Interactive Question',
                    metadata: ['answerMode: interactive_question', 'questionId: q_profile_followup'],
                  },
                ],
              },
            },
          ],
        }),
      });
    });

    await page.route(`**/api/chat/threads/${threadId}/memory-insights**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          data: [],
          meta: {
            total: 0,
            limit: 1,
            category: 'all',
            groupBy: 'category',
            groupedCounts: {},
          },
        }),
      });
    });

    await page.goto(`/threads/${threadId}`);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=You have a strong base profile overall.')).toBeVisible();
    await expect(page.locator('text=Choose how you want to continue:')).toBeVisible();
    await page.locator('button:has-text("Optional action")').click();
    await expect(page.locator('button:has-text("Resume tweak")')).toBeVisible();
    await expect(page.locator('button:has-text("LinkedIn optimization tip")')).toBeVisible();
    await expect(page.locator('button:has-text("Both")')).toBeVisible();
    await expect(page.locator('text=Recommended')).toBeVisible();
  });

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
