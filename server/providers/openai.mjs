export class OpenAIProvider {
  #cfg;
  constructor(cfg) { this.#cfg = cfg; }
  async stream(_res, _messages, _systemPrompt) {
    throw new Error('OpenAI provider not yet implemented — coming in Task 7');
  }
}
