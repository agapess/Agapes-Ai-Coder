/**
 * @param {string} text - raw LLM output (may contain markdown fences)
 * @returns {{ summary: string; files: string[]; uses: string[]; features: string[]; clarifyingQuestion?: string; clarifyOptions?: string[] } | null}
 */
export function parsePlanJson(text) {
  const cleaned = text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (!obj.summary || !Array.isArray(obj.files)) return null;
    return {
      summary:             String(obj.summary),
      files:               (obj.files    ?? []).map(String),
      uses:                (obj.uses     ?? []).map(String),
      features:            (obj.features ?? []).map(String),
      ...(obj.clarifyingQuestion ? { clarifyingQuestion: String(obj.clarifyingQuestion) } : {}),
      ...(Array.isArray(obj.clarifyOptions) ? { clarifyOptions: obj.clarifyOptions.map(String) } : {}),
      ...(Array.isArray(obj.suggestions) ? { suggestions: obj.suggestions.map(String) } : {}),
    };
  } catch { return null; }
}
