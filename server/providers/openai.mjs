import OpenAI from 'openai';

function toOpenAIMsg(m) {
  if (m.imageData) {
    return {
      role: m.role,
      content: [
        { type: 'image_url', image_url: { url: m.imageData } },
        { type: 'text', text: m.content || 'Recreate this design as a clean web app.' },
      ],
    };
  }
  return { role: m.role, content: m.content };
}

export class OpenAIProvider {
  #cfg;

  constructor(cfg) {
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('No API key. Enter one in Settings or set OPENAI_API_KEY env var.');
    }

    const client = new OpenAI({
      apiKey,
      baseURL: this.#cfg.baseUrl || 'https://api.openai.com/v1',
      defaultHeaders: this.#cfg.headers ?? {},
    });

    // Local models (LM Studio, Ollama) may not support stream_options; use large token limit
    const isLocal = !!this.#cfg.isLocal;
    const maxTokens = isLocal ? 131072 : 16000;

    const requestParams = {
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: maxTokens,
      stream:     true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(toOpenAIMsg),
      ],
    };

    // stream_options.include_usage is an OpenAI extension — skip for local models
    if (!isLocal) {
      requestParams.stream_options = { include_usage: true };
    }

    const stream = await client.chat.completions.create(requestParams);

    let inputTokens = 0, outputTokens = 0;
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      if (chunk.usage) {
        inputTokens  = chunk.usage.prompt_tokens     ?? 0;
        outputTokens = chunk.usage.completion_tokens ?? 0;
      }
    }
    if (inputTokens || outputTokens) {
      res.write(`data: ${JSON.stringify({ usage: { inputTokens, outputTokens } })}\n\n`);
    }
  }

  async generate(messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No API key. Enter one in Settings or set OPENAI_API_KEY env var.');

    const client = new OpenAI({
      apiKey,
      baseURL: this.#cfg.baseUrl || 'https://api.openai.com/v1',
      defaultHeaders: this.#cfg.headers ?? {},
    });

    const isLocal = !!this.#cfg.isLocal;

    const resp = await client.chat.completions.create({
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: isLocal ? 65536 : 4096,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(toOpenAIMsg),
      ],
    });

    return resp.choices[0].message.content ?? '';
  }
}
