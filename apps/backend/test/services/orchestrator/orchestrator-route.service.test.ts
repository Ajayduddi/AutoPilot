import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  classifyFollowUpRoute,
  isConfirmationLike,
  isDataFetchCommand,
  resolveQuestionForRerun,
} from '../../../src/services/orchestrator/orchestrator-route.service';
import { ChatService } from '../../../src/services/chat.service';
import { ContextService } from '../../../src/services/context/context.service';
import { WorkflowService } from '../../../src/services/workflow/workflow.service';

type CtxItem = {
  content: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
};

const originals = {
  getMessages: ChatService.getMessages,
  getLastWorkflowContext: ContextService.getLastWorkflowContext,
  getThreadContext: ContextService.getThreadContext,
  searchContext: ContextService.searchContext,
  getAll: WorkflowService.getAll,
};

let lastWorkflowContext: CtxItem | null;
let threadContext: CtxItem[];
let searchResults: any[];
let messages: any[];
let workflows: any[];

beforeEach(() => {
  lastWorkflowContext = null;
  threadContext = [];
  searchResults = [];
  messages = [];
  workflows = [];

  (ChatService as any).getMessages = async () => messages;
  (ContextService as any).getLastWorkflowContext = async () => lastWorkflowContext;
  (ContextService as any).getThreadContext = async () => threadContext;
  (ContextService as any).searchContext = async () => searchResults;
  (WorkflowService as any).getAll = async () => workflows;
});

afterEach(() => {
  (ChatService as any).getMessages = originals.getMessages;
  (ContextService as any).getLastWorkflowContext = originals.getLastWorkflowContext;
  (ContextService as any).getThreadContext = originals.getThreadContext;
  (ContextService as any).searchContext = originals.searchContext;
  (WorkflowService as any).getAll = originals.getAll;
});

describe('orchestrator-route.service', () => {
  it('detects confirmation-like prompts conservatively', () => {
    expect(isConfirmationLike('yes')).toBe(true);
    expect(isConfirmationLike('go ahead')).toBe(true);
    expect(isConfirmationLike('yes, tell me more about the results')).toBe(false);
  });

  it('detects explicit data-fetch commands', () => {
    expect(isDataFetchCommand('fetch the data')).toBe(true);
    expect(isDataFetchCommand('answer using the workflow data')).toBe(true);
    expect(isDataFetchCommand('what did the workflow return?')).toBe(false);
  });

  it('routes confirmation replies to explicit rerun using the pending assistant prompt workflow', async () => {
    messages = [
      {
        role: 'assistant',
        content: 'I need to run the portfolio workflow to fetch the latest numbers. Would you like me to proceed?',
        blocks: [
          {
            type: 'question_mcq',
            prompt: 'I can run the portfolio workflow now. Choose how you want to continue:',
            options: [
              { label: 'Approve and run', description: 'Run the workflow now.' },
              { label: 'Not now', description: 'Keep current context without running.' },
            ],
          },
        ],
      },
    ];
    workflows = [{ key: 'portfolio', name: 'Portfolio', enabled: true, archived: false }];

    const route = await classifyFollowUpRoute('thread_confirm', 'yes');

    expect(route).toEqual({ kind: 'explicit_rerun', workflowKey: 'portfolio' });
  });

  it('routes show-previous requests to the latest workflow context item', async () => {
    lastWorkflowContext = {
      content: 'Net worth: $1.2M',
      metadata: { workflowKey: 'portfolio', workflowName: 'Portfolio Snapshot' },
    };

    const route = await classifyFollowUpRoute('thread_previous', 'show me the last result');

    expect(route.kind).toBe('show_previous');
    expect((route as any).contextItem?.content).toBe('Net worth: $1.2M');
  });

  it('routes explicit cached-choice prompts to use_cached_choice', async () => {
    lastWorkflowContext = {
      content: 'Cached output',
      metadata: { workflowKey: 'portfolio' },
    };
    messages = [
      {
        role: 'assistant',
        content: 'Latest answer from portfolio.',
        blocks: [{ type: 'source', metadata: ['workflow: portfolio'] }],
      },
    ];

    const route = await classifyFollowUpRoute('thread_cached', 'use cached');

    expect(route).toEqual({
      kind: 'use_cached_choice',
      workflowKey: 'portfolio',
      contextItem: lastWorkflowContext,
    });
  });

  it('routes short follow-up questions to followup_answer using the preferred workflow source', async () => {
    const portfolioItem = {
      content: 'Portfolio result',
      metadata: { workflowKey: 'portfolio' },
      createdAt: new Date().toISOString(),
    };
    lastWorkflowContext = {
      content: 'Other workflow result',
      metadata: { workflowKey: 'other' },
      createdAt: new Date().toISOString(),
    };
    threadContext = [portfolioItem, lastWorkflowContext];
    messages = [
      {
        role: 'assistant',
        content: 'Here is the latest portfolio answer.',
        blocks: [{ type: 'source', metadata: ['workflow: portfolio'] }],
      },
    ];

    const route = await classifyFollowUpRoute('thread_followup', 'what about cash position?');

    expect(route).toEqual({
      kind: 'followup_answer',
      workflowKey: 'portfolio',
      contextItem: portfolioItem,
    });
  });

  it('falls back to the last meaningful user question when resolving rerun questions', async () => {
    messages = [
      { role: 'user', content: 'show me the current portfolio allocation by sector' },
      { role: 'assistant', content: 'I can run the portfolio workflow if you want.' },
      { role: 'user', content: 'yes' },
    ];

    const resolved = await resolveQuestionForRerun('thread_rerun', 'yes');

    expect(resolved).toBe('show me the current portfolio allocation by sector');
  });
});
