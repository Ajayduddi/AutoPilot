import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SemanticSearchService } from '../../../src/services/retrieval/semantic-search.service';
import { RecommendationService } from '../../../src/services/retrieval/recommendation.service';
import { RagService } from '../../../src/services/retrieval/rag.service';
import { EmbeddingService } from '../../../src/services/retrieval/embedding.service';
import { SemanticSearchRepo } from '../../../src/repositories/semantic-search.repo';
import { RecommendationRepo } from '../../../src/repositories/recommendation.repo';
import { WorkflowService } from '../../../src/services/workflow/workflow.service';
import { ChatRepo } from '../../../src/repositories/chat.repo';

const originals = {
  embedText: EmbeddingService.embedText,
  searchWorkflows: SemanticSearchRepo.searchWorkflows,
  searchDocumentChunks: SemanticSearchRepo.searchDocumentChunks,
  searchWorkflowRuns: SemanticSearchRepo.searchWorkflowRuns,
  listAccessible: WorkflowService.listAccessible,
  recommendWorkflows: RecommendationRepo.recommendWorkflows,
  recommendRuns: RecommendationRepo.recommendRuns,
  recommendDocumentChunks: RecommendationRepo.recommendDocumentChunks,
  getAttachmentChunksByAttachmentIds: ChatRepo.getAttachmentChunksByAttachmentIds,
  semanticSearchDocuments: SemanticSearchService.searchDocuments,
};

afterEach(() => {
  (EmbeddingService as any).embedText = originals.embedText;
  (SemanticSearchRepo as any).searchWorkflows = originals.searchWorkflows;
  (SemanticSearchRepo as any).searchDocumentChunks = originals.searchDocumentChunks;
  (SemanticSearchRepo as any).searchWorkflowRuns = originals.searchWorkflowRuns;
  (WorkflowService as any).listAccessible = originals.listAccessible;
  (RecommendationRepo as any).recommendWorkflows = originals.recommendWorkflows;
  (RecommendationRepo as any).recommendRuns = originals.recommendRuns;
  (RecommendationRepo as any).recommendDocumentChunks = originals.recommendDocumentChunks;
  (ChatRepo as any).getAttachmentChunksByAttachmentIds = originals.getAttachmentChunksByAttachmentIds;
  (SemanticSearchService as any).searchDocuments = originals.semanticSearchDocuments;
});

beforeEach(() => {
  SemanticSearchService.resetCachesForTests();
});

describe('retrieval layer service behavior', () => {
  it('workflow semantic search degrades to lexical fallback when embeddings fail', async () => {
    (EmbeddingService as any).embedText = async () => {
      throw new Error('embedding provider unavailable');
    };
    (WorkflowService as any).listAccessible = async () => ([
      {
        id: 'wf_1',
        key: 'resume_parser',
        name: 'Resume Parser',
        description: 'Extract resume fields',
        provider: 'n8n',
        visibility: 'public',
        enabled: true,
        archived: false,
      },
    ]);

    const result = await SemanticSearchService.searchWorkflows({
      userId: 'usr_1',
      query: 'resume extraction flow',
      limit: 5,
    });

    expect(result.mode).toBe('lexical_fallback');
    expect(result.results.length).toBe(1);
    expect(result.results[0].key).toBe('resume_parser');
  });

  it('document semantic search returns ranked snippets', async () => {
    (EmbeddingService as any).embedText = async () => ({
      vector: [0.1, 0.2, 0.3],
      modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
    });
    (SemanticSearchRepo as any).searchDocumentChunks = async () => ([
      {
        chunkId: 'ck_1',
        attachmentId: 'att_1',
        filename: 'invoice.pdf',
        mimeType: 'application/pdf',
        threadId: 'th_1',
        chunkIndex: 2,
        content: 'Total amount due is $12,440 payable by 2026-01-15.',
        tokenCount: 18,
        similarity: 0.91,
      },
    ]);

    const result = await SemanticSearchService.searchDocuments({
      userId: 'usr_1',
      query: 'what is the total amount',
      threadId: 'th_1',
    });

    expect(result.mode).toBe('semantic');
    expect(result.results.length).toBe(1);
    expect(result.results[0].snippet).toContain('Total amount due');
    expect(result.results[0].similarity).toBeCloseTo(0.91, 3);
  });

  it('run semantic search returns unavailable mode when embeddings fail', async () => {
    (EmbeddingService as any).embedText = async () => {
      throw new Error('provider timeout');
    };

    const result = await SemanticSearchService.searchRuns({
      userId: 'usr_1',
      query: 'similar failure to webhook timeout',
      onlyFailures: true,
    });

    expect(result.mode).toBe('unavailable');
    expect(result.results).toEqual([]);
  });

  it('reuses cached semantic query results for repeated identical searches', async () => {
    let embedCalls = 0;
    let repoCalls = 0;

    (EmbeddingService as any).embedText = async () => {
      embedCalls += 1;
      return {
        vector: [0.1, 0.2, 0.3],
        modelInfo: { provider: 'gemini', model: 'text-embedding-004', dimensions: 3, maxBatchSize: 32 },
      };
    };
    (SemanticSearchRepo as any).searchDocumentChunks = async () => {
      repoCalls += 1;
      return [
        {
          chunkId: 'ck_cached',
          attachmentId: 'att_cached',
          filename: 'invoice.pdf',
          mimeType: 'application/pdf',
          threadId: 'th_cache',
          chunkIndex: 0,
          content: 'Cached result',
          tokenCount: 2,
          similarity: 0.87,
        },
      ];
    };

    const first = await SemanticSearchService.searchDocuments({
      userId: 'usr_1',
      query: 'cached lookup',
      threadId: 'th_cache',
    });
    const second = await SemanticSearchService.searchDocuments({
      userId: 'usr_1',
      query: 'cached lookup',
      threadId: 'th_cache',
    });

    expect(first.results.length).toBe(1);
    expect(second.results.length).toBe(1);
    expect(embedCalls).toBe(1);
    expect(repoCalls).toBe(1);
  });

  it('workflow recommendations return semantic mode with normalized similarity', async () => {
    (RecommendationRepo as any).recommendWorkflows = async () => ([
      {
        workflowId: 'wf_2',
        key: 'invoice_reader',
        name: 'Invoice Reader',
        description: 'Parses invoices and sends summaries',
        provider: 'n8n',
        visibility: 'public',
        enabled: true,
        archived: false,
        similarity: 0.88,
      },
    ]);

    const result = await RecommendationService.recommendSimilarWorkflows({
      workflowId: 'wf_1',
      userId: 'usr_1',
      limit: 5,
    });

    expect(result.mode).toBe('semantic');
    expect(result.results.length).toBe(1);
    expect(result.results[0].workflowId).toBe('wf_2');
    expect(result.results[0].similarity).toBeCloseTo(0.88, 3);
  });

  it('document recommendations degrade gracefully when repo errors', async () => {
    (RecommendationRepo as any).recommendDocumentChunks = async () => {
      throw new Error('db unavailable');
    };

    const result = await RecommendationService.recommendRelatedDocumentChunks({
      attachmentId: 'att_1',
      userId: 'usr_1',
      limit: 3,
    });

    expect(result.mode).toBe('unavailable');
    expect(result.results).toEqual([]);
  });

  it('rag attachment context uses semantic retrieval when available', async () => {
    (SemanticSearchService as any).searchDocuments = async () => ({
      mode: 'semantic',
      results: [
        {
          chunkId: 'ck_1',
          attachmentId: 'att_1',
          filename: 'agreement.pdf',
          threadId: 'th_1',
          chunkIndex: 1,
          content: 'The renewal date is 2026-09-30 and notice period is 30 days.',
          similarity: 0.93,
        },
      ],
    });

    const result = await RagService.buildAttachmentContext({
      userId: 'usr_1',
      threadId: 'th_1',
      query: 'what is the renewal date',
      attachments: [
        {
          id: 'att_1',
          filename: 'agreement.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          processingStatus: 'processed',
        },
      ],
    });

    expect(result.mode).toBe('semantic');
    expect(result.hasEvidence).toBe(true);
    expect(result.promptText).toContain('renewal date');
    expect(result.sourceBlock?.origin).toBe('Processed Files (RAG)');
  });

  it('rag attachment context falls back to chunk scan when semantic search has no hits', async () => {
    (SemanticSearchService as any).searchDocuments = async () => ({ mode: 'semantic', results: [] });
    (ChatRepo as any).getAttachmentChunksByAttachmentIds = async () => ([
      {
        id: 'ck_2',
        attachmentId: 'att_2',
        chunkIndex: 0,
        content: 'Client email is ops@example.com for notices.',
        tokenCount: 10,
        metadata: { source: 'doc_text' },
      },
    ]);

    const result = await RagService.buildAttachmentContext({
      userId: 'usr_1',
      threadId: 'th_2',
      query: 'find client email',
      attachments: [
        {
          id: 'att_2',
          filename: 'contract.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          sizeBytes: 4096,
          processingStatus: 'processed',
        },
      ],
    });

    expect(result.mode).toBe('fallback');
    expect(result.hasEvidence).toBe(true);
    expect(result.promptText).toContain('Client email is');
    expect(result.sourceBlock?.origin).toBe('Processed Files');
  });
});
