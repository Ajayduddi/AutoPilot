import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ContextMemoryExtractionService } from '../../../src/services/context/context-memory-extraction.service';
import { LLMService } from '../../../src/services/ai-routing/llm.service';
import { ContextService } from '../../../src/services/context/context.service';

const originals = {
  extractThreadMemoryCandidates: LLMService.extractThreadMemoryCandidates,
  indexChatSummary: ContextService.indexChatSummary,
  maybeIndexChatSummaryFromTurn: ContextService.maybeIndexChatSummaryFromTurn,
};

beforeEach(() => {
  (LLMService as any).extractThreadMemoryCandidates = originals.extractThreadMemoryCandidates;
  (ContextService as any).indexChatSummary = originals.indexChatSummary;
  (ContextService as any).maybeIndexChatSummaryFromTurn = originals.maybeIndexChatSummaryFromTurn;
});

afterEach(() => {
  (LLMService as any).extractThreadMemoryCandidates = originals.extractThreadMemoryCandidates;
  (ContextService as any).indexChatSummary = originals.indexChatSummary;
  (ContextService as any).maybeIndexChatSummaryFromTurn = originals.maybeIndexChatSummaryFromTurn;
});

describe('ContextMemoryExtractionService', () => {
  it('stores valid LLM-derived durable memory candidates', async () => {
    const indexed: any[] = [];
    let heuristicFallbacks = 0;

    (LLMService as any).extractThreadMemoryCandidates = async () => ({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      candidates: [
        {
          summary: 'User prefers concise markdown answers',
          content: 'The user explicitly prefers concise answers and markdown formatting for tables.',
          summaryKind: 'preference',
          importance: 'high',
          entityKeys: ['concise', 'markdown'],
          shouldStore: true,
        },
      ],
    });
    (ContextService as any).indexChatSummary = async (input: any) => {
      indexed.push(input);
    };
    (ContextService as any).maybeIndexChatSummaryFromTurn = async () => {
      heuristicFallbacks += 1;
    };

    await ContextMemoryExtractionService.extractAndIndexFromTurn({
      threadId: 'thread_1',
      userId: 'user_1',
      userMessage: 'Please remember that I prefer concise answers and markdown tables.',
      assistantReply: 'Noted. I will keep answers concise and use markdown tables when useful.',
      sourceMessageIds: ['msg_u', 'msg_a'],
    });

    expect(indexed.length).toBe(1);
    expect(indexed[0].summaryKind).toBe('preference');
    expect(indexed[0].importance).toBe('high');
    expect(indexed[0].sourceMessageIds).toEqual(['msg_u', 'msg_a']);
    expect(heuristicFallbacks).toBe(0);
  });

  it('falls back to heuristic memory extraction when LLM returns no durable candidates', async () => {
    let heuristicFallbacks = 0;
    let indexedCount = 0;

    (LLMService as any).extractThreadMemoryCandidates = async () => ({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      candidates: [
        {
          summary: 'No durable memory',
          content: 'This should not be stored.',
          summaryKind: 'recap',
          importance: 'low',
          entityKeys: [],
          shouldStore: false,
        },
      ],
    });
    (ContextService as any).indexChatSummary = async () => {
      indexedCount += 1;
    };
    (ContextService as any).maybeIndexChatSummaryFromTurn = async () => {
      heuristicFallbacks += 1;
    };

    await ContextMemoryExtractionService.extractAndIndexFromTurn({
      threadId: 'thread_2',
      userId: 'user_1',
      userMessage: 'Please remember that this project is for the Acme renewal.',
      assistantReply: 'I will keep the Acme renewal context in mind.',
      sourceMessageIds: ['msg_1', 'msg_2'],
    });

    expect(indexedCount).toBe(0);
    expect(heuristicFallbacks).toBe(1);
  });

  it('falls back to heuristic extraction when LLM extraction throws', async () => {
    let heuristicFallbacks = 0;

    (LLMService as any).extractThreadMemoryCandidates = async () => {
      throw new Error('provider timeout');
    };
    (ContextService as any).maybeIndexChatSummaryFromTurn = async () => {
      heuristicFallbacks += 1;
    };

    await ContextMemoryExtractionService.extractAndIndexFromTurn({
      threadId: 'thread_3',
      userId: 'user_1',
      userMessage: 'Please remember that the client is Acme.',
      assistantReply: 'Understood.',
      sourceMessageIds: ['msg_3', 'msg_4'],
    });

    expect(heuristicFallbacks).toBe(1);
  });

  it('redacts sensitive token-like content before storing LLM-derived memory', async () => {
    const indexed: any[] = [];

    (LLMService as any).extractThreadMemoryCandidates = async () => ({
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      candidates: [
        {
          summary: 'Credential-bearing note sk_secret_abcdefghijklmnopqrstuvwxyz123456',
          content: 'Remember apiKey=super-secret-value and Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456 plus https://example.com?token=abcd1234',
          summaryKind: 'recap',
          importance: 'medium',
          entityKeys: ['credential'],
          shouldStore: true,
        },
      ],
    });
    (ContextService as any).indexChatSummary = async (input: any) => {
      indexed.push(input);
    };
    (ContextService as any).maybeIndexChatSummaryFromTurn = async () => {};

    await ContextMemoryExtractionService.extractAndIndexFromTurn({
      threadId: 'thread_secret',
      userId: 'user_1',
      userMessage: 'Please remember that this credential note contains sensitive tokens and should be stored safely.',
      assistantReply: 'Understood. I will store only the safe, redacted version of that credential note.',
      sourceMessageIds: ['msg_secret'],
    });

    expect(indexed.length).toBe(1);
    expect(indexed[0].summary).not.toContain('sk_secret_abcdefghijklmnopqrstuvwxyz123456');
    expect(indexed[0].summary).toContain('[REDACTED]');
    expect(indexed[0].content).not.toContain('super-secret-value');
    expect(indexed[0].content).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(indexed[0].content).not.toContain('token=abcd1234');
    expect(indexed[0].content).toContain('[REDACTED]');
  });
});
