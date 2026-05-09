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
    const lastRaw = messages[messages.length - 1];
    let lastMsg;
    if (lastRaw?.imageData) {
      const [header, b64] = lastRaw.imageData.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      lastMsg = [
        { inlineData: { mimeType, data: b64 } },
        { text: lastRaw.content || 'Recreate this design as a clean web app.' },
      ];
    } else {
      lastMsg = lastRaw?.content ?? '';
    }

    const chat   = model.startChat({ history });
    const result = await chat.sendMessageStream(lastMsg);

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }
  }

  async generate(messages, systemPrompt) {
    const apiKey = this.#cfg.apiKey?.trim() || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('No API key. Enter one in Settings or set GEMINI_API_KEY env var.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model:             this.#cfg.model || 'gemini-2.0-flash',
      systemInstruction: systemPrompt,
    });

    const history = messages.slice(0, -1).map((m) => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const lastRaw = messages[messages.length - 1];
    let lastMsg;
    if (lastRaw?.imageData) {
      const [header, b64] = lastRaw.imageData.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      lastMsg = [
        { inlineData: { mimeType, data: b64 } },
        { text: lastRaw.content || 'Recreate this design as a clean web app.' },
      ];
    } else {
      lastMsg = lastRaw?.content ?? '';
    }

    const chat   = model.startChat({ history });
    const result = await chat.sendMessage(lastMsg);
    return result.response.text();
  }
}
