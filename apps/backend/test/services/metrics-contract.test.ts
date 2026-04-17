import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { PromptContextService } from '../../src/services/context/prompt-context.service';
import { ContextService } from '../../src/services/context/context.service';
import { EmbeddingService } from '../../src/services/retrieval/embedding.service';
import { ContextRepo } from '../../src/repositories/context.repo';
import { renderPrometheusMetrics, stopMetricsExporter } from '../../src/util/metrics';
import { buildRuntimeClockPromptSection } from '../../src/services/context/prompt-context.service';

const originals = {
  getHybridThreadContext: ContextService.getHybridThreadContext,
  formatForPrompt: ContextService.formatForPrompt,
  embedText: EmbeddingService.embedText,
  searchSemanticInThread: ContextRepo.searchSemanticInThread,
};

beforeEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ContextService as any).getHybridThreadContext = originals.getHybridThreadContext;
  (ContextService as any).formatForPrompt = originals.formatForPrompt;
  (EmbeddingService as any).embedText = originals.embedText;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
});

afterEach(() => {
  ContextService.resetSemanticThreadMemoryCacheForTests();
  (ContextService as any).getHybridThreadContext = originals.getHybridThreadContext;
  (ContextService as any).formatForPrompt = originals.formatForPrompt;
  (EmbeddingService as any).embedText = originals.embedText;
  (ContextRepo as any).searchSemanticInThread = originals.searchSemanticInThread;
  stopMetricsExporter();
});

describe('metrics contract for prompt-context and semantic memory', () => {
  it('renders the new metric names after the instrumented code paths execute', async () => {
    (ContextService as any).getHybridThreadContext = async () => ([
      {
        id: 'ctx_1',
        threadId: 'thread_metrics',
        userId: 'user_1',
        category: 'thread_state',
        workflowRunId: null,
        workflowId: null,
        content: 'Last workflow: metrics_review',
        summary: 'Thread state',
        metadata: {},
        createdAt: new Date(),
        expiresAt: null,
      },
    ]);
    (ContextService as any).formatForPrompt = () => '=== RETRIEVED CONTEXT ===\n[Thread State]\n- Last workflow: metrics_review';

    await PromptContextService.buildHybridThreadPromptContext({
      surface: 'agent',
      threadId: 'thread_metrics',
      userId: 'user_1',
      query: 'What did we do before?',
      temporalInput: { headerTimezone: 'Asia/Kolkata' },
      categories: ['thread_state'],
    });

    (EmbeddingService as any).embedText = async () => ({
      vector: [0.1, 0.2, 0.3],
      modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
    });
    (ContextRepo as any).searchSemanticInThread = async () => ([
      {
        id: 'ctx_summary',
        threadId: 'thread_metrics',
        userId: 'user_1',
        category: 'chat_summary',
        workflowRunId: null,
        workflowId: null,
        content: 'The renewal note was discussed before.',
        summary: 'Renewal note',
        metadata: { summaryKind: 'entity', importance: 'medium' },
        createdAt: new Date(),
        expiresAt: null,
        similarity: 0.92,
        sourceType: 'chat_summary',
      },
    ]);

    await ContextService.searchSemanticThreadMemory({
      threadId: 'thread_metrics',
      userId: 'user_1',
      query: 'What did we discuss earlier about the renewal note?',
      limit: 3,
    });
    await ContextService.searchSemanticThreadMemory({
      threadId: 'thread_metrics',
      userId: 'user_1',
      query: 'What did we discuss earlier about the renewal note?',
      limit: 3,
    });

    const metrics = renderPrometheusMetrics();

    expect(buildRuntimeClockPromptSection({ headerTimezone: 'Asia/Kolkata' })).toContain('Asia/Kolkata');
    expect(metrics).toContain('# TYPE autopilot_prompt_context_build_total counter');
    expect(metrics).toContain('# TYPE autopilot_prompt_context_build_latency_ms histogram');
    expect(metrics).toContain('# TYPE autopilot_context_semantic_memory_cache_total counter');
    expect(metrics).toContain('# TYPE autopilot_context_semantic_memory_search_latency_ms histogram');
  });
});
