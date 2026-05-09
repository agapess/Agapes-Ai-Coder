import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiProvider {
  #cfg;

  constructor(cfg) {
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('No API key. Enter one in Settings or set GEMINI_API_KEY env var.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model:             this.#cfg.model || 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    // Convert FORGE message format to Gemini format
    const history = messages.slice(0, -1).map((m) => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastMsg = messages[messages.length - 1]?.content ?? '';

    const chat   = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }
}
