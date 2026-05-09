export class GeminiProvider {
  #cfg;
  constructor(cfg) { this.#cfg = cfg; }
  async stream(_res, _messages, _systemPrompt) {
    throw new Error('Gemini provider not yet implemented — coming in Task 8');
  }
}
