import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ContextService } from '../../../src/services/context/context.service';
import { ContextRepo } from '../../../src/repositories/context.repo';
import { EmbeddingIndexService } from '../../../src/services/retrieval/embedding-index.service';
import { EmbeddingService } from '../../../src/services/retrieval/embedding.service';
import { EmbeddingRepo } from '../../../src/repositories/embedding.repo';

const originals = {
  create: ContextRepo.create,
  updateById: ContextRepo.updateById,
  findLatestChatSummary: ContextRepo.findLatestChatSummary,
  getByThread: ContextRepo.getByThread,
  getByThreadAndCategory: ContextRepo.getByThreadAndCategory,
  searchSemanticInThread: ContextRepo.searchSemanticInThread,
  indexChatSummary: EmbeddingIndexService.indexChatSummary,
  embedText: EmbeddingService.embedText,
  findBySourceIds: EmbeddingRepo.findBySourceIds,
  getThreadCategoryCounts: ContextRepo.getThreadCategoryCounts,
};

beforeEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ContextRepo as any).create = originals.create;
  (ContextRepo as any).updateById = originals.updateById;
  (ContextRepo as any).findLatestChatSummary = originals.findLatestChatSummary;
  (ContextRepo as any).getByThread = originals.getByThread;
  (ContextRepo as any).getByThreadAndCategory = originals.getByThreadAndCategory;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
  (EmbeddingIndexService as any).indexChatSummary = originals.indexChatSummary;
  (EmbeddingService as any).embedText = originals.embedText;
  (EmbeddingRepo as any).findBySourceIds = originals.findBySourceIds;
  (ContextRepo as any).getThreadCategoryCounts = originals.getThreadCategoryCounts;
});

afterEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ContextRepo as any).create = originals.create;
  (ContextRepo as any).updateById = originals.updateById;
  (ContextRepo as any).findLatestChatSummary = originals.findLatestChatSummary;
  (ContextRepo as any).getByThread = originals.getByThread;
  (ContextRepo as any).getByThreadAndCategory = originals.getByThreadAndCategory;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
  (EmbeddingIndexService as any).indexChatSummary = originals.indexChatSummary;
  (EmbeddingService as any).embedText = originals.embedText;
  (EmbeddingRepo as any).findBySourceIds = originals.findBySourceIds;
  (ContextRepo as any).getThreadCategoryCounts = originals.getThreadCategoryCounts;
});

describe('ContextService hybrid memory', () => {
  it('creates a durable chat summary for explicit user preferences and indexes it', async () => {
    const created: any[] = [];
    const indexed: any[] = [];

    (ContextRepo as any).findLatestChatSummary = async () => null;
    (ContextRepo as any).create = async (input: any) => {
      created.push(input);
      return {
        ...input,
        threadId: input.threadId || null,
        userId: input.userId || null,
        workflowRunId: input.workflowRunId || null,
        workflowId: input.workflowId || null,
        summary: input.summary || null,
        metadata: input.metadata || null,
        createdAt: new Date(),
        expiresAt: input.expiresAt || null,
      };
    };
    (EmbeddingIndexService as any).indexChatSummary = async (input: any) => {
      indexed.push(input);
      return { changed: true };
    };

    await ContextService.maybeIndexChatSummaryFromTurn({
      threadId: 'thread_pref',
      userId: 'user_1',
      userMessage: 'Please remember that I prefer concise answers and markdown tables.',
      assistantReply: 'Understood. I will keep replies concise and use markdown tables when useful.',
      sourceMessageIds: ['msg_user', 'msg_assistant'],
    });

    expect(created.length).toBe(1);
    expect(created[0].category).toBe('chat_summary');
    expect(created[0].metadata.summaryKind).toBe('preference');
    expect(created[0].metadata.sourceMessageIds).toEqual(['msg_user', 'msg_assistant']);
    expect(indexed.length).toBe(1);
    expect(indexed[0].threadId).toBe('thread_pref');
  });

  it('adds semantic thread memory for fuzzy historical questions', async () => {
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

    let semanticCalls = 0;
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

    const result = await ContextService.getHybridThreadContext('thread_hist', {
      userId: 'user_1',
      query: 'What did we discuss earlier about the Acme renewal?',
      categories: ['thread_state', 'workflow_run'],
      exactLimit: 6,
      semanticLimit: 3,
    });

    expect(result.map((item) => item.id)).toEqual(['ctx_state', 'ctx_summary']);
    expect(semanticCalls).toBe(1);
  });

  it('keeps exact follow-up prompts on direct context without semantic lookup', async () => {
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

    let semanticCalls = 0;
    (EmbeddingService as any).embedText = async () => {
      semanticCalls += 1;
      return {
        vector: [0.1, 0.2, 0.3],
        modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
      };
    };

    const result = await ContextService.getHybridThreadContext('thread_exact', {
      userId: 'user_1',
      query: 'run it again',
      categories: ['thread_state', 'workflow_run'],
      exactLimit: 6,
      semanticLimit: 3,
    });

    expect(result.map((item) => item.id)).toEqual(['ctx_run']);
    expect(semanticCalls).toBe(0);
  });

  it('lists thread memory insights with embedding presence', async () => {
    (ContextRepo as any).getByThread = async () => ([
      {
        id: 'ctx_summary',
        threadId: 'thread_4',
        userId: 'user_1',
        category: 'chat_summary',
        workflowRunId: null,
        workflowId: null,
        content: 'User prefers concise markdown answers.',
        summary: 'Preference summary',
        metadata: { summaryKind: 'preference', importance: 'high', entityKeys: ['concise', 'markdown'] },
        createdAt: new Date('2026-04-10T00:00:00.000Z'),
        expiresAt: null,
      },
      {
        id: 'ctx_run',
        threadId: 'thread_4',
        userId: 'user_1',
        category: 'workflow_run',
        workflowRunId: 'run_4',
        workflowId: 'wf_4',
        content: 'Workflow run result',
        summary: 'Run summary',
        metadata: {},
        createdAt: new Date('2026-04-10T01:00:00.000Z'),
        expiresAt: null,
      },
    ]);
    (EmbeddingRepo as any).findBySourceIds = async (sourceType: string, ids: string[]) => {
      if (sourceType === 'chat_summary') return ids.includes('ctx_summary') ? [{ sourceId: 'ctx_summary' }] : [];
      if (sourceType === 'workflow_run') return ids.includes('run_4') ? [{ sourceId: 'run_4' }] : [];
      return [];
    };
    (ContextRepo as any).getThreadCategoryCounts = async () => ({
      workflow_run: 1,
      assistant_decision: 0,
      thread_state: 0,
      audit_event: 0,
      chat_summary: 1,
    });

    const insights = await ContextService.listThreadMemoryInsights('thread_4');

    expect(insights.length).toBe(2);
    expect(insights[0].category).toBe('chat_summary');
    expect(insights[0].hasEmbedding).toBe(true);
    expect(insights[0].summaryKind).toBe('preference');
    expect(insights[1].category).toBe('workflow_run');
    expect(insights[1].hasEmbedding).toBe(true);
  });

  it('applies memory insight category and grouping options', async () => {
    (ContextRepo as any).getByThreadAndCategory = async () => ([
      {
        id: 'ctx_summary_b',
        threadId: 'thread_5',
        userId: 'user_1',
        category: 'chat_summary',
        workflowRunId: null,
        workflowId: null,
        content: 'Second summary',
        summary: 'Summary B',
        metadata: {},
        createdAt: new Date('2026-04-10T03:00:00.000Z'),
        expiresAt: null,
      },
      {
        id: 'ctx_summary_a',
        threadId: 'thread_5',
        userId: 'user_1',
        category: 'chat_summary',
        workflowRunId: null,
        workflowId: null,
        content: 'First summary',
        summary: 'Summary A',
        metadata: {},
        createdAt: new Date('2026-04-10T01:00:00.000Z'),
        expiresAt: null,
      },
    ]);
    (EmbeddingRepo as any).findBySourceIds = async () => [];
    (ContextRepo as any).getThreadCategoryCounts = async () => ({
      workflow_run: 0,
      assistant_decision: 0,
      thread_state: 0,
      audit_event: 0,
      chat_summary: 2,
    });

    const summary = await ContextService.listThreadMemoryInsightsSummary('thread_5', {
      limit: 10,
      category: 'chat_summary',
      groupBy: 'category',
    });
    const insights = summary.items;

    expect(insights.length).toBe(2);
    expect(insights[0].id).toBe('ctx_summary_b');
    expect(insights[1].id).toBe('ctx_summary_a');
    expect(summary.groupedCounts.chat_summary).toBe(2);
    expect(summary.total).toBe(2);
  });
});
