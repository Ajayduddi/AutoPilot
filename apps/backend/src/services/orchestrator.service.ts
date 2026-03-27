import { LLMService } from './llm.service';
import { WorkflowService } from './workflow.service';
import { ChatService } from './chat.service';
import { ContextService } from './context.service';
import type { ConversationMessage, RetrievedContext } from '../providers/llm/provider.interface';
import { contextConfig, getContextMaxRetrievalForModel } from '../config/context.config';

type StreamBlock = { type: string; [key: string]: any };

type StreamCallbacks = {
  onBlock: (index: number, block: StreamBlock) => void;
  onChunk: (blockIndex: number, content: string) => void;
  onBlockEnd: (blockIndex: number) => void;
};

// ─── Follow-up detection ───────────────────────────────────────────────────────

type FollowUpResult =
  | { detected: false }
  | { detected: true; action: 'retry'; workflowKey: string }
  | { detected: true; action: 'show_previous'; contextItem: any }
  | { detected: true; action: 'entity_search'; query: string; results: any[] };

const RETRY_PATTERNS = [
  /\b(run|do|execute|trigger)\s+(it|that|this)\s+(again|once more)/i,
  /\bretry\b/i,
  /\b(run|do)\s+again\b/i,
  /\bsame\s+(workflow|thing)\s+again\b/i,
  /\brepeat\s+(it|that|this|the)\b/i,
  /\bredo\b/i,
];

// Matches bare confirmations like "yes", "sure", "do it", "go ahead", "okay run it"
const CONFIRMATION_PATTERNS = [
  /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|please|please do|run it|go for it)\s*[.!]?\s*$/i,
  /^\s*(yes|yeah|sure|ok|okay)\s+(check|run|do|go|fetch|scan|trigger|please)/i,
];

const SHOW_PREVIOUS_PATTERNS = [
  /\b(show|display|give me|what was)\s+(the\s+)?(previous|last|prior)\s+(output|result|response|data)/i,
  /\bprevious\s+(output|result)/i,
  /\blast\s+(result|output|run)/i,
  /\bwhat\s+(happened|did it return|was the result|were the results)/i,
  /\bshow\s+(me\s+)?(the\s+)?results?\s+again/i,
];

/**
 * Detect follow-up patterns deterministically before calling the LLM.
 * Returns a typed result indicating whether a follow-up was detected and what action to take.
 */
async function detectFollowUp(threadId: string, message: string): Promise<FollowUpResult> {
  if (!contextConfig.enabled) return { detected: false };

  const msg = message.trim();

  // 1. Retry / run-again detection
  if (RETRY_PATTERNS.some(p => p.test(msg))) {
    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      const meta = lastCtx.metadata as Record<string, unknown> | null;
      const workflowKey = meta?.workflowKey as string;
      if (workflowKey) {
        console.log(`[Orchestrator] Follow-up detected: retry → ${workflowKey}`);
        return { detected: true, action: 'retry', workflowKey };
      }
    }
  }

  // 1b. Confirmation detection: "yes" / "sure" / "do it" after a workflow suggestion
  if (CONFIRMATION_PATTERNS.some(p => p.test(msg))) {
    // Check if the last assistant message suggested a workflow
    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      const meta = lastCtx.metadata as Record<string, unknown> | null;
      const workflowKey = meta?.workflowKey as string;
      if (workflowKey) {
        console.log(`[Orchestrator] Follow-up detected: confirmation → ${workflowKey}`);
        return { detected: true, action: 'retry', workflowKey };
      }
    }
  }

  // 2. Show previous output
  if (SHOW_PREVIOUS_PATTERNS.some(p => p.test(msg))) {
    const lastCtx = await ContextService.getLastWorkflowContext(threadId);
    if (lastCtx) {
      console.log('[Orchestrator] Follow-up detected: show_previous');
      return { detected: true, action: 'show_previous', contextItem: lastCtx };
    }
  }

  // 3. Entity-based follow-up: "what about the email", "tell me about the scores"
  const entityMatch = msg.match(/\b(?:what\s+(?:about|is|are|was|were)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:tell\s+me\s+(?:about|more\s+about)\s+(?:the|my)?\s*)(.+)/i)
    || msg.match(/\b(?:show\s+(?:me\s+)?(?:the|my)?\s*)(.+?)(?:\s+(?:from|in)\s+(?:the|that|last)\s+(?:result|output|workflow))?$/i);

  if (entityMatch) {
    const query = entityMatch[1].trim().replace(/[?.!]+$/, '');
    if (query.length >= 3 && query.length <= 100) {
      const results = await ContextService.searchContext(threadId, query, 3);
      if (results.length > 0) {
        console.log(`[Orchestrator] Follow-up detected: entity_search for "${query}" (${results.length} results)`);
        return { detected: true, action: 'entity_search', query, results };
      }
    }
  }

  return { detected: false };
}

// ─── Validation helpers ────────────────────────────────────────────────────────

type WorkflowValidation =
  | { ok: true; workflow: any }
  | { ok: false; reason: string; errorCode: string };

async function resolveAndValidateWorkflow(workflowKey: string): Promise<WorkflowValidation> {
  const workflow = await WorkflowService.getByKeyInternal(workflowKey);

  if (!workflow) {
    return { ok: false, reason: `Workflow '${workflowKey}' was not found.`, errorCode: 'WORKFLOW_NOT_FOUND' };
  }
  if (workflow.archived) {
    return { ok: false, reason: `Workflow '${workflow.name}' is archived and cannot be triggered.`, errorCode: 'WORKFLOW_ARCHIVED' };
  }
  if (!workflow.enabled) {
    return { ok: false, reason: `Workflow '${workflow.name}' is currently disabled.`, errorCode: 'WORKFLOW_DISABLED' };
  }
  if (!workflow.executionEndpoint) {
    return { ok: false, reason: `Workflow '${workflow.name}' has no execution endpoint configured.`, errorCode: 'NO_ENDPOINT' };
  }
  if (workflow.visibility === 'private') {
    // For now, allow — in multi-user mode this would check ownership
  }

  return { ok: true, workflow };
}

// ─── Result formatting ─────────────────────────────────────────────────────────

function formatRunResult(run: any): string[] {
  const items: string[] = [];
  const status = run.status || 'unknown';

  if (status === 'completed') {
    items.push(`✓ Execution completed successfully`);
  } else if (status === 'failed') {
    items.push(`✗ Execution failed`);
  } else {
    items.push(`Status: ${status}`);
  }

  // Duration
  if (run.startedAt && run.finishedAt) {
    const dur = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    if (dur < 1000) items.push(`Duration: ${dur}ms`);
    else items.push(`Duration: ${(dur / 1000).toFixed(1)}s`);
  }

  // Normalized output summary
  if (run.normalizedOutput) {
    const out = run.normalizedOutput;
    if (typeof out === 'string') {
      items.push(out.slice(0, 300));
    } else if (out.message) {
      items.push(String(out.message).slice(0, 300));
    } else if (out.summary) {
      items.push(String(out.summary).slice(0, 300));
    } else {
      const keys = Object.keys(out);
      if (keys.length <= 5) {
        keys.forEach(k => items.push(`${k}: ${JSON.stringify(out[k]).slice(0, 100)}`));
      } else {
        items.push(`Returned ${keys.length} fields`);
      }
    }
  }

  // Error details
  if (run.errorPayload) {
    const err = run.errorPayload;
    items.push(`Error: ${err.error || err.message || JSON.stringify(err).slice(0, 200)}`);
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────────

export class OrchestratorService {
  /**
   * Build conversation history from recent messages in the thread.
   * Returns last N user/assistant message pairs as ConversationMessage[].
   */
  private static async buildConversationHistory(threadId: string, model?: string): Promise<ConversationMessage[]> {
    try {
      const maxMessages = getContextMaxRetrievalForModel(model) * 2; // pairs of user+assistant
      const allMessages = await ChatService.getMessages(threadId);
      // Take the most recent N messages (excluding the current one which hasn't been saved yet)
      const recent = allMessages.slice(-maxMessages);
      return recent
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
    } catch (err) {
      console.error('[Orchestrator] Failed to fetch conversation history:', err);
      return [];
    }
  }

  /** Legacy synchronous handler — kept for non-streaming POST route. */
  static async handleIncomingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId?: string,
    model?: string,
  ) {
    // ── Context retrieval for legacy handler ──
    const retrievalLimit = getContextMaxRetrievalForModel(model);
    const history = await OrchestratorService.buildConversationHistory(threadId, model);
    const threadContext = await ContextService.getThreadContext(threadId, {
      categories: ['thread_state', 'workflow_run'],
      limit: retrievalLimit,
    });
    const contextPromptSection = ContextService.formatForPrompt(threadContext);
    const retrievedContext: RetrievedContext | undefined = contextPromptSection
      ? { formatted: contextPromptSection }
      : undefined;

    // ── Pre-LLM follow-up detection ──
    const followUp = await detectFollowUp(threadId, content);
    if (followUp.detected) {
      if (followUp.action === 'retry') {
        // Treat as a workflow intent directly
        const intent = { type: 'workflow' as const, workflowKey: followUp.workflowKey, parameters: {} };
        const validation = await resolveAndValidateWorkflow(intent.workflowKey);
        if (!validation.ok) {
          return await ChatService.addMessage(threadId, 'assistant', validation.reason, {
            blocks: [{ type: 'error', message: validation.reason, code: validation.errorCode }],
          });
        }
        const { workflow } = validation;
        const run = await WorkflowService.executeAndAwait(
          workflow.id, workflow.key, workflow.provider, workflow.executionEndpoint,
          userId, traceId, 'chat', intent.parameters, threadId,
        );
        const resultItems = formatRunResult(run);
        const summaryText = run.status === 'completed'
          ? `**${workflow.name}** completed successfully.`
          : `**${workflow.name}** finished with status: ${run.status}.`;
        return await ChatService.addMessage(threadId, 'assistant', summaryText, {
          blocks: [
            { type: 'workflow_status', workflow: { name: workflow.name, status: run.status, runId: run.id, startedAt: run.startedAt, completedAt: run.finishedAt, timeline: summaryText } },
            { type: run.status === 'failed' ? 'error' : 'result', title: run.status === 'failed' ? 'Execution Failed' : 'Results', items: resultItems, message: resultItems.join(' • ') },
          ],
        });
      }
      if (followUp.action === 'show_previous') {
        return await ChatService.addMessage(threadId, 'assistant', followUp.contextItem.content, {
          blocks: [{ type: 'markdown', text: `**Previous Result:**\n\n${followUp.contextItem.content}` }],
        });
      }
    }

    const intent = await LLMService.parseIntent(content, providerId, model, history, retrievedContext);

    if (intent.type === 'workflow' && intent.workflowKey) {
      const validation = await resolveAndValidateWorkflow(intent.workflowKey);

      if (!validation.ok) {
        if (validation.errorCode === 'WORKFLOW_NOT_FOUND') {
          // LLM hallucinated a workflow key — fall back to chat
          console.warn(`[Orchestrator:Legacy] LLM suggested non-existent workflow '${intent.workflowKey}', falling back to chat`);
          const fallbackReply = intent.reply || "I'm not sure how to help with that. Could you rephrase your question?";
          return await ChatService.addMessage(threadId, 'assistant', fallbackReply);
        }
        return await ChatService.addMessage(threadId, 'assistant', validation.reason, {
          blocks: [{ type: 'error', message: validation.reason, code: validation.errorCode }],
        });
      }

      const { workflow } = validation;
      // ── Context-aware decisioning: check cache before executing ──
      const cacheResult = await ContextService.evaluateCacheHit(threadId, workflow.key, intent.parameters);

      if (cacheResult.hit) {
        // Answer from cached context instead of re-executing
        const cachedAnswer = `Based on the recent **${cacheResult.workflowName}** run (${cacheResult.ageSeconds}s ago):\n\n${cacheResult.cachedData.slice(0, 2000)}`;
        return await ChatService.addMessage(threadId, 'assistant', cachedAnswer, {
          blocks: [
            { type: 'markdown', text: cachedAnswer },
            { type: 'source', origin: `Cached — ${cacheResult.workflowName}`, metadata: [`From cached run (${cacheResult.ageSeconds}s ago)`, `Workflow: ${workflow.key}`] },
          ],
        });
      }

      const run = await WorkflowService.executeAndAwait(
        workflow.id, workflow.key, workflow.provider, workflow.executionEndpoint,
        userId, traceId, 'chat', intent.parameters, threadId,
      );

      const resultItems = formatRunResult(run);
      const summaryText = run.status === 'completed'
        ? `**${workflow.name}** completed successfully.`
        : `**${workflow.name}** finished with status: ${run.status}.`;

      return await ChatService.addMessage(threadId, 'assistant', summaryText, {
        blocks: [
          { type: 'workflow_status', workflow: { name: workflow.name, status: run.status, runId: run.id, startedAt: run.startedAt, completedAt: run.finishedAt, timeline: summaryText } },
          { type: run.status === 'failed' ? 'error' : 'result', title: run.status === 'failed' ? 'Execution Failed' : 'Results', items: resultItems, message: resultItems.join(' • ') },
          { type: 'source', origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`, metadata: [`Workflow: ${workflow.key}`, `Run: ${run.id}`, `Provider: ${workflow.provider}`] },
        ],
      });

    } else {
      return await ChatService.addMessage(threadId, 'assistant', intent.reply || "I didn't quite catch that.");
    }
  }

  /**
   * Streaming handler: emits blocks and text chunks via callbacks as they resolve.
   * Saves the final assistant message to DB and returns it.
   */
  static async handleStreamingMessage(
    threadId: string,
    content: string,
    traceId: string,
    userId: string,
    providerId: string | undefined,
    model: string | undefined,
    callbacks: StreamCallbacks,
  ): Promise<{ id: string; createdAt: any }> {
    // ── Context retrieval ──
    const retrievalLimit = getContextMaxRetrievalForModel(model);
    const threadContext = await ContextService.getThreadContext(threadId, {
      categories: ['thread_state', 'workflow_run'],
      limit: retrievalLimit,
    });
    const contextPromptSection = ContextService.formatForPrompt(threadContext);

    // ── Build conversation history + retrieved context for LLM ──
    const history = await OrchestratorService.buildConversationHistory(threadId, model);
    const retrievedContext: RetrievedContext | undefined = contextPromptSection
      ? { formatted: contextPromptSection }
      : undefined;

    // ── Pre-LLM follow-up detection ──
    const followUp = await detectFollowUp(threadId, content);

    // Handle "show previous output" entirely locally — no LLM needed
    if (followUp.detected && followUp.action === 'show_previous') {
      const blocks: StreamBlock[] = [];
      let blockIndex = 0;

      const meta = followUp.contextItem.metadata as Record<string, unknown> | null;
      const workflowName = (meta?.workflowName as string) || 'Previous workflow';

      const mdBlock: StreamBlock = {
        type: 'markdown',
        text: `**${workflowName} — Previous Result:**\n\n${followUp.contextItem.content}`,
      };
      callbacks.onBlock(blockIndex, mdBlock);
      callbacks.onChunk(blockIndex, mdBlock.text);
      callbacks.onBlockEnd(blockIndex);
      blocks.push(mdBlock);

      return await ChatService.addMessage(
        threadId, 'assistant',
        mdBlock.text.slice(0, 500),
        { blocks },
      );
    }

    // Handle "retry" by overriding intent to the last workflow
    let intent;
    if (followUp.detected && followUp.action === 'retry') {
      intent = { type: 'workflow' as const, workflowKey: followUp.workflowKey, parameters: {} };
      ContextService.indexAssistantDecision({
        threadId,
        intentType: 'workflow',
        workflowKey: followUp.workflowKey,
        userMessage: content,
      }).catch(() => {});
    } else if (followUp.detected && followUp.action === 'entity_search') {
      // Entity follow-up: build context from search results and let the LLM answer
      const searchContext = ContextService.formatForPrompt(followUp.results);
      const enrichedContext: RetrievedContext = {
        formatted: searchContext || contextPromptSection || '',
      };
      intent = await LLMService.parseIntent(content, providerId, model, history, enrichedContext);
    } else {
      intent = await LLMService.parseIntent(content, providerId, model, history, retrievedContext);
    }

    // ── Index assistant decision into context memory (skip if already indexed by follow-up handler) ──
    if (!followUp.detected || followUp.action === 'entity_search') {
      ContextService.indexAssistantDecision({
        threadId,
        intentType: intent.type,
        workflowKey: intent.workflowKey,
        userMessage: content,
      }).catch(() => {}); // fire-and-forget, never block
    }

    const blocks: StreamBlock[] = [];
    let blockIndex = 0;

    // ── Workflow path: validate key exists before executing ──
    let workflowValidation: Awaited<ReturnType<typeof resolveAndValidateWorkflow>> | null = null;
    if (intent.type === 'workflow' && intent.workflowKey) {
      workflowValidation = await resolveAndValidateWorkflow(intent.workflowKey);
      if (!workflowValidation.ok && workflowValidation.errorCode === 'WORKFLOW_NOT_FOUND') {
        // LLM hallucinated a workflow key — fall back to chat
        console.warn(`[Orchestrator] LLM suggested non-existent workflow '${intent.workflowKey}', falling back to chat`);
        workflowValidation = null;
        intent = { type: 'chat' as const, reply: undefined, workflowKey: undefined, parameters: undefined };
      }
    }

    if (intent.type === 'workflow' && intent.workflowKey && workflowValidation) {

      if (!workflowValidation.ok) {
        const errorBlock: StreamBlock = {
          type: 'error',
          title: 'Cannot Run Workflow',
          message: workflowValidation.reason,
          code: workflowValidation.errorCode,
        };
        callbacks.onBlock(blockIndex++, errorBlock);
        blocks.push(errorBlock);
      } else {
        const { workflow } = workflowValidation;

        // ── Context-aware decisioning: check cache before executing ──
        const isRetryFollowUp = followUp.detected && followUp.action === 'retry';
        const cacheResult = isRetryFollowUp
          ? { hit: false as const, reason: 'retry_followup' }
          : await ContextService.evaluateCacheHit(threadId, workflow.key, intent.parameters);

        if (cacheResult.hit) {
          // Answer from cached context — skip workflow execution
          const aiBlockIdx = blockIndex++;
          const aiBlock: StreamBlock = { type: 'markdown', text: '' };
          blocks.push(aiBlock);
          callbacks.onBlock(aiBlockIdx, { ...aiBlock });

          const cachePrompt =
            `The user asked: "${content}"\n\n` +
            `A workflow named "${cacheResult.workflowName}" was recently executed (${cacheResult.ageSeconds}s ago) ` +
            `and returned the following cached data:\n` +
            `\`\`\`\n${cacheResult.cachedData.slice(0, 8000)}\n\`\`\`\n\n` +
            `INSTRUCTIONS:\n` +
            `1. Answer the user's question DIRECTLY using ONLY the cached data above.\n` +
            `2. Quote specific facts, names, numbers, and dates exactly as they appear.\n` +
            `3. Use markdown formatting for readability.\n` +
            `4. Keep the response concise but complete.`;

          let fullText = '';
          try {
            for await (const chunk of LLMService.streamReply(cachePrompt, providerId, model)) {
              fullText += chunk;
              aiBlock.text = fullText;
              callbacks.onChunk(aiBlockIdx, chunk);
            }
          } catch (err) {
            console.error('[Orchestrator] Cached answer generation failed:', err);
            fullText = cacheResult.cachedData.slice(0, 2000);
            aiBlock.text = fullText;
            callbacks.onChunk(aiBlockIdx, fullText);
          }
          callbacks.onBlockEnd(aiBlockIdx);
          aiBlock.text = fullText;

          // Source block indicating cached origin
          const sourceBlock: StreamBlock = {
            type: 'source',
            origin: `Cached — ${cacheResult.workflowName}`,
            metadata: [
              `From cached run (${cacheResult.ageSeconds}s ago)`,
              `Workflow: ${workflow.key}`,
            ],
          };
          callbacks.onBlock(blockIndex++, sourceBlock);
          blocks.push(sourceBlock);
        } else {
          // ── Fresh execution path ──

        // 1. Summary block — immediate feedback
        const summaryBlock: StreamBlock = {
          type: 'summary',
          items: [`Triggering **${workflow.name}** via ${workflow.provider}…`],
        };
        callbacks.onBlock(blockIndex++, summaryBlock);
        blocks.push(summaryBlock);

        // 2. Workflow status block — shows "running" state
        const workflowBlock: StreamBlock = {
          type: 'workflow_status',
          workflow: {
            name: workflow.name,
            status: 'running',
            runId: '', // will be updated
            startedAt: new Date().toISOString(),
            timeline: 'Execution in progress',
            details: { workflow_key: workflow.key, provider: workflow.provider },
          },
        };
        callbacks.onBlock(blockIndex++, workflowBlock);
        blocks.push(workflowBlock);

        // 3. Execute and AWAIT result
        const run = await WorkflowService.executeAndAwait(
          workflow.id, workflow.key, workflow.provider, workflow.executionEndpoint,
          userId, traceId, 'chat', intent.parameters, threadId,
        );

        // Enrich context memory with original user question
        // (WorkflowService already indexed the run, but without the question)
        ContextService.updateThreadState({
          threadId,
          lastWorkflowKey: workflow.key,
          lastWorkflowRunId: run.id,
          lastWorkflowStatus: run.status,
          lastWorkflowName: workflow.name,
          lastSubject: content.slice(0, 200),
        }).catch(() => {});

        // Patch the user's question into the workflow run context for follow-up search
        ContextService.patchWorkflowRunQuestion(threadId, run.id, content).catch(() => {});

        // Update the workflow block with final status
        workflowBlock.workflow.status = run.status;
        workflowBlock.workflow.runId = run.id;
        workflowBlock.workflow.completedAt = run.finishedAt;
        workflowBlock.workflow.timeline = run.status === 'completed' ? 'Completed' : run.status === 'failed' ? 'Execution failed' : run.status;

        // Re-emit the updated workflow block
        callbacks.onBlock(blockIndex - 1, workflowBlock);

        // 4. Result or Error block
        const resultItems = formatRunResult(run);
        if (run.status === 'failed') {
          const errorBlock: StreamBlock = {
            type: 'error',
            title: 'Execution Failed',
            message: resultItems.join(' • '),
            code: 'WORKFLOW_EXECUTION_FAILED',
          };
          callbacks.onBlock(blockIndex++, errorBlock);
          blocks.push(errorBlock);
        } else {
          const resultBlock: StreamBlock = {
            type: 'result',
            title: 'Results',
            items: resultItems,
          };
          callbacks.onBlock(blockIndex++, resultBlock);
          blocks.push(resultBlock);

          // 4b. AI-generated summary of the workflow results
          const aiBlockIdx = blockIndex++;
          const aiBlock: StreamBlock = { type: 'markdown', text: '' };
          blocks.push(aiBlock);
          callbacks.onBlock(aiBlockIdx, { ...aiBlock });

          const resultData = run.normalizedOutput
            ? JSON.stringify(run.normalizedOutput, null, 2).slice(0, 8000)
            : resultItems.join('\n');

          const summaryPrompt =
            `The user asked: "${content}"\n\n` +
            `A workflow named "${workflow.name}" was executed and returned the following JSON data:\n` +
            `\`\`\`json\n${resultData}\n\`\`\`\n\n` +
            `INSTRUCTIONS:\n` +
            `1. Answer the user's original question DIRECTLY and ACCURATELY using ONLY the data above.\n` +
            `2. Extract the specific facts/values from the data that answer their question — do not paraphrase or generalize.\n` +
            `3. If the data contains names, numbers, dates, or locations, quote them exactly as they appear.\n` +
            `4. Use markdown formatting for readability.\n` +
            `5. Keep the response concise but complete — include all relevant details from the data.`;

          let fullSummary = '';
          try {
            for await (const chunk of LLMService.streamReply(summaryPrompt, providerId, model)) {
              fullSummary += chunk;
              aiBlock.text = fullSummary;
              callbacks.onChunk(aiBlockIdx, chunk);
            }
          } catch (err) {
            console.error('[Orchestrator] AI summary generation failed:', err);
            fullSummary = resultItems.join('\n');
            aiBlock.text = fullSummary;
            callbacks.onChunk(aiBlockIdx, fullSummary);
          }
          callbacks.onBlockEnd(aiBlockIdx);
          aiBlock.text = fullSummary;
        }

        // 5. Source metadata block
        const sourceBlock: StreamBlock = {
          type: 'source',
          origin: `${workflow.provider.charAt(0).toUpperCase() + workflow.provider.slice(1)} Workflow Engine`,
          metadata: [`Workflow: ${workflow.key}`, `Run: ${run.id}`, `Provider: ${workflow.provider}`],
        };
        callbacks.onBlock(blockIndex++, sourceBlock);
        blocks.push(sourceBlock);

        // 6. Actions block
        const actionsBlock: StreamBlock = {
          type: 'actions',
          items: [
            { id: 'view-run', label: 'View Run', variant: 'primary', entityId: run.id },
            ...(run.status === 'failed' ? [{ id: 'retry-workflow', label: 'Retry', variant: 'secondary', entityId: workflow.id }] : []),
          ],
        };
        callbacks.onBlock(blockIndex++, actionsBlock);
        blocks.push(actionsBlock);
        } // end fresh execution path
      } // end validation.ok + cache-hit/miss
    } else {
      // Chat reply — stream tokens from LLM
      // Use enriched context for entity search follow-ups, otherwise standard context
      const chatContext = (followUp.detected && followUp.action === 'entity_search')
        ? { formatted: ContextService.formatForPrompt(followUp.results) || contextPromptSection || '' }
        : retrievedContext;

      const textBlockIdx = blockIndex++;
      const textBlock: StreamBlock = { type: 'markdown', text: '' };
      blocks.push(textBlock);
      // Emit an empty block first so the frontend knows a text block is incoming
      callbacks.onBlock(textBlockIdx, { ...textBlock });

      let fullText = '';
      try {
        for await (const chunk of LLMService.streamReply(content, providerId, model, history, chatContext)) {
          fullText += chunk;
          textBlock.text = fullText;
          callbacks.onChunk(textBlockIdx, chunk);
        }
      } catch (err) {
        const fallback = intent.reply || "I couldn't generate a response at this time.";
        fullText = fallback;
        textBlock.text = fullText;
        callbacks.onChunk(textBlockIdx, fallback);
      }
      callbacks.onBlockEnd(textBlockIdx);
      textBlock.text = fullText;
    }

    // Persist the final assembled message
    const contentSummary = blocks
      .filter(b => b.type === 'markdown' || b.type === 'text')
      .map(b => String(b.text || ''))
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);

    const saved = await ChatService.addMessage(
      threadId,
      'assistant',
      contentSummary || '[workflow triggered]',
      { blocks },
    );

    return saved;
  }
}
