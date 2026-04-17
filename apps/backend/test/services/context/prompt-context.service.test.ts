import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PromptContextService } from '../../../src/services/context/prompt-context.service';
import { ContextService } from '../../../src/services/context/context.service';

const originals = {
  getHybridThreadContext: ContextService.getHybridThreadContext,
  formatForPrompt: ContextService.formatForPrompt,
};

beforeEach(() => {
  (ContextService as any).getHybridThreadContext = originals.getHybridThreadContext;
  (ContextService as any).formatForPrompt = originals.formatForPrompt;
});

afterEach(() => {
  (ContextService as any).getHybridThreadContext = originals.getHybridThreadContext;
  (ContextService as any).formatForPrompt = originals.formatForPrompt;
});

describe('PromptContextService', () => {
  it('builds retrieved context with temporal section and formatted memory', async () => {
    (ContextService as any).getHybridThreadContext = async () => ([
      {
        id: 'ctx_1',
        threadId: 'thread_1',
        userId: 'user_1',
        category: 'thread_state',
        workflowRunId: null,
        workflowId: null,
        content: 'Last workflow: resume_review',
        summary: 'Thread state',
        metadata: {},
        createdAt: new Date(),
        expiresAt: null,
      },
    ]);
    (ContextService as any).formatForPrompt = () => '=== RETRIEVED CONTEXT ===\n[Thread State]\n- Last workflow: resume_review';

    const result = await PromptContextService.buildHybridThreadPromptContext({
      threadId: 'thread_1',
      userId: 'user_1',
      query: 'What did we do before?',
      temporalInput: { headerTimezone: 'Asia/Kolkata' },
      categories: ['thread_state'],
    });

    expect(result.contextText).toContain('[Deterministic Temporal Context]');
    expect(result.contextText).toContain('Asia/Kolkata');
    expect(result.contextText).toContain('=== RETRIEVED CONTEXT ===');
    expect(result.retrievedContext?.formatted).toContain('resume_review');
  });
});
