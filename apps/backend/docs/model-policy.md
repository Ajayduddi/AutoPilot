# AI Model Policy Strategy

This automation platform uses a modular, factory-driven approach to AI Providers.

## 1. Abstraction Interface (`ILLMProvider`)
Every external AI API maps to the standard interface:
```typescript
interface ILLMProvider {
  name: string;
  parseIntent(message: string, workflows: WorkflowContext[]): Promise<ParsedIntent>;
  generateReply(message: string): Promise<string>;
}
```

## 2. Dynamic Registry Configs
Adapters are instantly loaded based on the `provider_configs` SQL table:
- **Default Policy:** The orchestrator fetches the row where `is_default = true`.
- **Primary Failover:** If no row is selected or the DB lacks configs, it attempts to load local `Ollama` via `OLLAMA_URL` (defaulting to `localhost:11434`) to guarantee zero-downtime execution environments where cloud API keys fall out of scope.

## 3. Supported Wrappers
- **Ollama**: Free, local, private. Perfect for airgapped or on-prem deployments. Assumes `llama3` if model name isn't provided.
- **Gemini / Groq / Mistral**: Cloud providers. Fast inference via SDKs. Secured strictly by `api_key` columns in Postgres.

*Future:* We plan to introduce fallback cascades directly in the factory so when `Gemini` HTTP requests timeout, it degrades gracefully to `Ollama`.
