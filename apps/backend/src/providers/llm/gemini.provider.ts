import { ILLMProvider, WorkflowContext, ParsedIntent, ConversationMessage, RetrievedContext } from './provider.interface';

export class GeminiProvider implements ILLMProvider {
  name = 'gemini';

  constructor(private apiKey: string, private modelName: string) {}

  async parseIntent(
    message: string,
    workflows: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<ParsedIntent> {
    console.log(`[Gemini] Intention matching on ${this.modelName}`);
    
    const msg = message.toLowerCase();

    // Check retrieved context for follow-up references like "run it again", "retry", etc.
    if (context?.formatted) {
      const followUpPatterns = ['run it again', 'retry', 'do it again', 'run again', 'previous result', 'last result', 'show the last'];
      if (followUpPatterns.some(p => msg.includes(p))) {
        // Extract the last workflow key from context metadata
        const keyMatch = context.formatted.match(/lastWorkflowKey["']?:\s*["']?([\w-]+)/);
        if (keyMatch) {
          return { type: 'workflow', workflowKey: keyMatch[1], parameters: {} };
        }
      }
    }
    
    // Direct keyword matching against workflow names, keys, tags
    // Skip description matching (too loose — common words in descriptions cause false positives)
    const STOP_WORDS = new Set(['a','an','the','is','are','was','were','be','my','me','i','you','it','to','of','in','for','on','and','or','not','with','this','that','from','name','data','info','get','set','run','check','show','tell','do']);
    for (const wf of workflows) {
      if (!wf.enabled) continue;
      // Only match against key, name, and tags — not description
      const terms = [wf.key, wf.name, ...(wf.tags || [])]
        .map(t => t.toLowerCase());
      if (terms.some(t => {
        if (!t) return false;
        const normalized = t.replace(/^wf_/, '').replace(/_/g, ' ');
        // Skip matching if the workflow term is a common/short word
        if (normalized.length < 4 || STOP_WORDS.has(normalized)) return false;
        return msg.includes(normalized);
      })) {
        return { type: 'workflow', workflowKey: wf.key, parameters: {} };
      }
    }

    // Semantic matching: personal QUESTIONS → workflows that provide personal data
    // Only match question forms ("what is my name"), not statements ("my name is X")
    const personalQuestionPatterns = [
      /what(?:'s| is| are) my name/,
      /who am i/,
      /tell me my name/,
      /(?:show|get|fetch|display) my (?:profile|portfolio)/,
      /(?:tell me |what(?:'s| is) )about me/,
      /(?:show|get|what(?:'s| is| are)) my (?:info|details|data|skills|projects|experience|education|scores)/,
      /where (?:did |do )?i (?:stud|work|graduat)/,
      /check my (?:leetcode|score|rating|rank)/,
    ];
    if (personalQuestionPatterns.some(p => p.test(msg))) {
      // If context already has the data from a recent workflow, treat as chat follow-up
      if (context?.formatted && context.formatted.includes('workflow_run')) {
        return { type: 'chat', reply: await this.generateReply(message, workflows, history, context) };
      }
      const personalWorkflow = workflows.find(wf => {
        if (!wf.enabled) return false;
        const desc = (wf.description || '').toLowerCase();
        const name = wf.name.toLowerCase();
        return desc.includes('personal') || desc.includes('portfolio') || desc.includes('profile')
          || name.includes('portfolio') || name.includes('profile');
      });
      if (personalWorkflow) {
        return { type: 'workflow', workflowKey: personalWorkflow.key, parameters: {} };
      }
    }
    
    return { type: 'chat', reply: await this.generateReply(message, workflows, history, context) };
  }

  async generateReply(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): Promise<string> {
    // If retrieved context has recent workflow data, use it to answer
    if (context?.formatted) {
      return `I'm your AutoPilot assistant. Based on recent context, I can help with follow-up questions. ${context.formatted.slice(0, 500)}`;
    }
    const wfHints = workflows?.filter(w => w.enabled)
      .map(w => `"${w.name}" — ${w.description || 'No description'}`)
      .join(', ');
    const suggestion = wfHints ? ` I have these automations available: ${wfHints}. Try asking me to run one!` : '';
    return `I'm your AutoPilot assistant.${suggestion} How can I help you today?`;
  }

  async *generateReplyStream(
    message: string,
    workflows?: WorkflowContext[],
    history?: ConversationMessage[],
    context?: RetrievedContext,
  ): AsyncGenerator<string> {
    const reply = await this.generateReply(message, workflows, history, context);
    yield reply;
  }
}
