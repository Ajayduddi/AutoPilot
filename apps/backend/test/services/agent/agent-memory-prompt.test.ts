import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { __agentTestUtils } from '../../../src/services/agent/agent.service';
import { ChatService } from '../../../src/services/chat.service';
import { ContextRepo } from '../../../src/repositories/context.repo';
import { EmbeddingService } from '../../../src/services/retrieval/embedding.service';
import { ContextService } from '../../../src/services/context/context.service';

const originals = {
  getMessages: ChatService.getMessages,
  getByThreadAndCategory: ContextRepo.getByThreadAndCategory,
  searchSemanticInThread: ContextRepo.searchSemanticInThread,
  embedText: EmbeddingService.embedText,
};

beforeEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ChatService as any).getMessages = originals.getMessages;
  (ContextRepo as any).getByThreadAndCategory = originals.getByThreadAndCategory;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
  (EmbeddingService as any).embedText = originals.embedText;
});

afterEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ChatService as any).getMessages = originals.getMessages;
  (ContextRepo as any).getByThreadAndCategory = originals.getByThreadAndCategory;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
  (EmbeddingService as any).embedText = originals.embedText;
});

describe('Agent prompt assembly with semantic memory', () => {
  it('includes long-term semantic thread memory for fuzzy historical questions', async () => {
    let semanticCalls = 0;

    (ChatService as any).getMessages = async () => [];
    (ContextRepo as any).getByThreadAndCategory = async (_threadId: string, category: string) => {
      if (category === 'thread_state') {
        return [{
          id: 'ctx_state',
          threadId: 'thread_hist',
          userId: 'user_1',
          category: 'thread_state',
          workflowRunId: null,
          workflowId: null,
          content: 'Last workflow: contract_review (completed)',
          summary: 'Thread state',
          metadata: { lastWorkflowKey: 'contract_review' },
          createdAt: new Date(),
          expiresAt: null,
        }];
      }
      return [];
    };
    (EmbeddingService as any).embedText = async () => ({
      vector: [0.1, 0.2, 0.3],
      modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
    });
    (ContextRepo as any).searchSemanticInThread = async () => {
      semanticCalls += 1;
      return [{
        id: 'ctx_summary',
        threadId: 'thread_hist',
        userId: 'user_1',
        category: 'chat_summary',
        workflowRunId: null,
        workflowId: null,
        content: 'Acme renewal terms were discussed with a 30-day notice period.',
        summary: 'Renewal discussion summary',
        metadata: { summaryKind: 'entity', importance: 'medium' },
        createdAt: new Date(),
        expiresAt: null,
        similarity: 0.91,
        sourceType: 'chat_summary',
      }];
    };

    const result = await __agentTestUtils.buildPromptContext({
      threadId: 'thread_hist',
      content: 'What did we discuss earlier about the Acme renewal?',
      traceId: 'trace_1',
      userId: 'user_1',
    } as any);

    expect(result.contextText).toContain('=== RETRIEVED CONTEXT ===');
    expect(result.contextText).toContain('[Long-term Thread Memory]');
    expect(result.contextText).toContain('Renewal discussion summary');
    expect(semanticCalls).toBe(1);
  });

  it('keeps exact follow-up turns on direct context without semantic retrieval', async () => {
    let semanticCalls = 0;

    (ChatService as any).getMessages = async () => [];
    (ContextRepo as any).getByThreadAndCategory = async (_threadId: string, category: string) => {
      if (category === 'workflow_run') {
        return [{
          id: 'ctx_run',
          threadId: 'thread_exact',
          userId: 'user_1',
          category: 'workflow_run',
          workflowRunId: 'run_1',
          workflowId: 'wf_1',
          content: 'Workflow: invoice_lookup\nStatus: completed',
          summary: 'invoice_lookup completed',
          metadata: { workflowKey: 'invoice_lookup', status: 'completed' },
          createdAt: new Date(),
          expiresAt: null,
        }];
      }
      return [];
    };
    (EmbeddingService as any).embedText = async () => {
      semanticCalls += 1;
      return {
        vector: [0.1, 0.2, 0.3],
        modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
      };
    };
    (ContextRepo as any).searchSemanticInThread = async () => [];

    const result = await __agentTestUtils.buildPromptContext({
      threadId: 'thread_exact',
      content: 'run it again',
      traceId: 'trace_2',
      userId: 'user_1',
    } as any);

    expect(result.contextText).toContain('[Recent Workflow Results]');
    expect(result.contextText).not.toContain('[Long-term Thread Memory]');
    expect(semanticCalls).toBe(0);
  });

  it('includes deterministic temporal context in prompt assembly for grounded date math', async () => {
    (ChatService as any).getMessages = async () => [];
    (ContextRepo as any).getByThreadAndCategory = async () => [];
    (ContextRepo as any).searchSemanticInThread = async () => [];
    (EmbeddingService as any).embedText = async () => ({
      vector: [0.1, 0.2, 0.3],
      modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
    });

    const result = await __agentTestUtils.buildPromptContext({
      threadId: 'thread_time',
      content: 'How much experience do I have now?',
      traceId: 'trace_3',
      userId: 'user_1',
      temporalInput: { headerTimezone: 'Asia/Kolkata' },
    } as any);

    expect(result.contextText).toContain('[Deterministic Temporal Context]');
    expect(result.contextText).toContain('Asia/Kolkata');
  });
});
