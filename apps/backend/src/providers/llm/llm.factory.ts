import { db } from '../../db';
import { providerConfigs } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { ILLMProvider } from './provider.interface';
import { OllamaProvider } from './ollama.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAIProvider } from './openai.provider';

export class LLMFactory {
  static async getProvider(providerId?: string, overriddenModel?: string): Promise<ILLMProvider> {
    let config;
    if (providerId) {
      config = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.id, providerId)
      });
    }

    if (!config) {
      config = await db.query.providerConfigs.findFirst({
        where: eq(providerConfigs.isDefault, true)
      });
    }

    if (!config) {
      console.warn('[LLMFactory] No active provider linked. Falling back to local Ollama (llama3).');
      return new OllamaProvider(overriddenModel || 'llama3', process.env.OLLAMA_URL || 'http://localhost:11434');
    }

    const m = overriddenModel || config.model;

    switch (config.provider) {
      case 'ollama':
        return new OllamaProvider(m, process.env.OLLAMA_URL || 'http://localhost:11434');
      case 'gemini':
        return new GeminiProvider(config.apiKey || '', m);
      case 'openai':
        return new OpenAIProvider(m, config.apiKey || '', config.baseUrl || 'https://api.openai.com/v1');
      case 'mistral':
      case 'groq':
        return new OpenAIProvider(m, config.apiKey || '', config.baseUrl || 'https://api.openai.com/v1');
      default:
        // By default use OpenAI target if not matched, or Ollama
        if (config.provider !== 'ollama') {
          return new OpenAIProvider(m, config.apiKey || '', config.baseUrl || 'https://api.openai.com/v1');
        }
        return new OllamaProvider(m, 'http://localhost:11434');
    }
  }

  static async getDefaultProvider(): Promise<ILLMProvider> {
    return this.getProvider();
  }
}
