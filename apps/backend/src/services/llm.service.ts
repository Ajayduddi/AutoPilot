import { LLMFactory } from '../providers/llm/llm.factory';
import { WorkflowService } from './workflow.service';
import type { ParsedIntent, ConversationMessage, RetrievedContext } from '../providers/llm/provider.interface';
export type { ParsedIntent };

export class LLMService {
  static async parseIntent(
    message: string,
    providerId?: string,
    model?: string,
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    const provider = await LLMFactory.getProvider(providerId, model);
    
    // Fetch available workflows to pass as routing context
    const workflows = await WorkflowService.getAll();
    const workflowContext = workflows.map(wf => ({
      key: wf.key as string,
      name: (wf.name as string) || (wf.key as string),
      description: wf.description as string,
      provider: wf.provider as string,
      enabled: wf.enabled as boolean,
      visibility: wf.visibility as string,
      tags: (wf.tags as string[]) || [],
    }));

    try {
      return await provider.parseIntent(message, workflowContext, history, context);
    } catch (err) {
      console.error(`[LLMService] Primary AI provider ${provider.name} failed. Error:`, err);
      return {
        type: 'chat',
        reply: "Sorry, I lost connection to my AI provider backend. Please check the configurations."
      };
    }
  }

  static async *streamReply(
    message: string,
    providerId?: string,
    model?: string,
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): AsyncGenerator<string> {
    const provider = await LLMFactory.getProvider(providerId, model);

    // Fetch workflow context so chat replies can reference available automations
    const workflows = await WorkflowService.getAll();
    const workflowContext = workflows.map(wf => ({
      key: wf.key as string,
      name: (wf.name as string) || (wf.key as string),
      description: wf.description as string,
      provider: wf.provider as string,
      enabled: wf.enabled as boolean,
      visibility: wf.visibility as string,
      tags: (wf.tags as string[]) || [],
    }));

    if (provider.generateReplyStream) {
      yield* provider.generateReplyStream(message, workflowContext, history, context);
    } else {
      const reply = await provider.generateReply(message, workflowContext, history, context);
      yield reply;
    }
  }
}
