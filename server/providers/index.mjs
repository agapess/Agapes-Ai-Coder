import { AnthropicProvider } from './anthropic.mjs';
import { OpenAIProvider }    from './openai.mjs';
import { GeminiProvider }    from './gemini.mjs';

export function createProvider(llmConfig = {}) {
  const p = llmConfig.provider || 'anthropic';

  switch (p) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey:  llmConfig.apiKey || llmConfig.anthropicKey,
        baseUrl: llmConfig.baseUrl || llmConfig.anthropicBaseUrl,
        model:   llmConfig.model,
      });

    case 'openai':
      return new OpenAIProvider({
        apiKey:  llmConfig.apiKey,
        baseUrl: 'https://api.openai.com/v1',
        model:   llmConfig.model || 'gpt-4o',
      });

    case 'gemini':
      return new GeminiProvider({
        apiKey: llmConfig.apiKey,
        model:  llmConfig.model || 'gemini-2.0-flash',
      });

    case 'openrouter':
      return new OpenAIProvider({
        apiKey:  llmConfig.apiKey,
        baseUrl: 'https://openrouter.ai/api/v1',
        model:   llmConfig.model || 'openai/gpt-4o',
        headers: { 'HTTP-Referer': 'https://agapes.us', 'X-Title': 'Agapes Ai Coder' },
      });

    case 'ollama':
      return new OpenAIProvider({
        apiKey:   'ollama',
        baseUrl:  (llmConfig.baseUrl || 'http://localhost:11434').replace(/\/$/, '') + '/v1',
        model:    llmConfig.model || 'llama3',
        isLocal:  true,
      });

    case 'lmstudio':
    case 'local':
      return new OpenAIProvider({
        apiKey:   llmConfig.localKey || llmConfig.apiKey || 'lm-studio',
        baseUrl:  (llmConfig.localUrl || llmConfig.baseUrl || 'http://localhost:1234/v1').replace(/\/$/, ''),
        model:    llmConfig.localModel || llmConfig.model || 'local-model',
        isLocal:  true,
      });

    case 'custom':
      return new OpenAIProvider({
        apiKey:   llmConfig.apiKey,
        baseUrl:  (llmConfig.baseUrl || '').replace(/\/$/, ''),
        model:    llmConfig.model,
        isLocal:  !!(llmConfig.isLocal || /localhost|127\.0\.0\.1/.test(llmConfig.baseUrl || '')),
      });

    default:
      throw new Error(`Unknown LLM provider: ${p}`);
  }
}
