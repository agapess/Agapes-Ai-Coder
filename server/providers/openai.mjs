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
    });

    const stream = await client.chat.completions.create({
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: 16000,
      stream:     true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(toOpenAIMsg),
      ],
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }

  async generate(messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('No API key. Enter one in Settings or set OPENAI_API_KEY env var.');

    const client = new OpenAI({
      apiKey,
      baseURL: this.#cfg.baseUrl || 'https://api.openai.com/v1',
    });

    const resp = await client.chat.completions.create({
      model:      this.#cfg.model || 'gpt-4o',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map(toOpenAIMsg),
      ],
    });

    return resp.choices[0].message.content ?? '';
  }
}
