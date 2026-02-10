/**
 * AI Response Parser Utilities
 * Handles robust JSON extraction from AI model responses
 */

/**
 * Extract valid JSON from AI response text
 * Handles cases where AI appends explanatory text after JSON
 * Uses brace-depth matching for robustness
 */
export function extractJSON(text: string): string {
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return '{}';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }

  return cleaned.slice(start);
}

/**
 * Parse and validate JSON from AI response
 */
export function parseAIJSON<T = Record<string, unknown>>(content: string): T {
  const jsonStr = extractJSON(content);
  return JSON.parse(jsonStr) as T;
}

/**
 * Parse JSON from AI response with runtime type assertion
 */
export function parseAIJSONTyped<T>(content: string, typeCheck?: (obj: unknown) => boolean): T {
  const jsonStr = extractJSON(content);
  const parsed = JSON.parse(jsonStr);
  if (typeCheck && !typeCheck(parsed)) {
    throw new Error('Parsed JSON does not match expected type');
  }
  return parsed as T;
}
