function toAnthropicMsg(m) {
  if (m.imageData) {
    const [header, b64] = m.imageData.split(',');
    const media_type = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
    return {
      role: m.role,
      content: [
        { type: 'image', source: { type: 'base64', media_type, data: b64 } },
        { type: 'text', text: m.content || 'Recreate this design as a clean web app.' },
      ],
    };
  }
  return { role: m.role, content: m.content };
}

export class AnthropicProvider {
  #cfg;

  constructor(cfg) {
    this.#cfg = cfg;
  }

  async stream(res, messages, systemPrompt) {
    const base      = (this.#cfg.baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const apiKeyVal = this.#cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

    if (!authToken && !apiKeyVal) {
      throw new Error('No API key. Enter one in Settings or set ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN env var.');
    }

    const headers = {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'anthropic-beta':    'claude-code-20250219,interleaved-thinking-2025-05-14,effort-2025-11-24',
      'anthropic-dangerous-direct-browser-access': 'true',
      'user-agent':        'claude-cli/2.1.83 (external, claude-vscode, agent-sdk/0.2.92)',
      'x-app':             'cli',
      'x-stainless-lang':  'js',
      'x-stainless-package-version': '0.74.0',
      'x-stainless-os':    'Windows',
      'x-stainless-arch':  'x64',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v24.3.0',
      'accept':            'application/json',
    };
    if (authToken) {
      headers['authorization'] = `Bearer ${authToken}`;
    } else {
      headers['x-api-key'] = apiKeyVal;
    }

    const model = this.#cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

    const upstream = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model, max_tokens: 16000, stream: true,
        system: systemPrompt,
        messages: messages.map(toAnthropicMsg),
      }),
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      throw new Error(`Anthropic ${upstream.status}: ${body || upstream.statusText}`);
    }

    const reader = upstream.body.getReader();
    const dec    = new TextDecoder();
    let   buf    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        const p = t.slice(6).trim();
        if (p === '[DONE]') return;
        try {
          const parsed = JSON.parse(p);
          if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`);
          }
          if (parsed.type === 'error') throw new Error(parsed.error?.message || 'API error');
        } catch (e) {
          if (e.message !== 'API error' && !e.message.startsWith('Anthropic')) continue;
          else throw e;
        }
      }
    }
  }

  async generate(messages, systemPrompt) {
    const base      = (this.#cfg.baseUrl?.trim() || process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '');
    const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const apiKeyVal = this.#cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY;

    if (!authToken && !apiKeyVal) {
      throw new Error('No API key. Enter one in Settings or set ANTHROPIC_API_KEY env var.');
    }

    const headers = {
      'content-type':      'application/json',
      'anthropic-version': '2023-06-01',
      'accept':            'application/json',
    };
    if (authToken) {
      headers['authorization'] = `Bearer ${authToken}`;
    } else {
      headers['x-api-key'] = apiKeyVal;
    }

    const model = this.#cfg.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

    const resp = await fetch(`${base}/v1/messages`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({
        model, max_tokens: 1024, stream: false,
        system:   systemPrompt,
        messages: messages.map(toAnthropicMsg),
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Anthropic ${resp.status}: ${body || resp.statusText}`);
    }

    const data = await resp.json();
    return data.content[0].text;
  }
}
