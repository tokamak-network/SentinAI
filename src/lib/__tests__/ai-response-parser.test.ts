/**
 * Unit tests for ai-response-parser module
 * Tests JSON extraction and parsing from AI responses
 */

import { describe, it, expect } from 'vitest';
import { extractJSON, parseAIJSON, parseAIJSONTyped } from '@/lib/ai-response-parser';

describe('ai-response-parser', () => {
  describe('extractJSON', () => {
    it('should extract simple JSON object', () => {
      const text = '{"name": "test", "value": 42}';

      const result = extractJSON(text);

      expect(result).toBe('{"name": "test", "value": 42}');
    });

    it('should extract JSON from markdown code blocks', () => {
      const text = '```json\n{"name": "test"}\n```';

      const result = extractJSON(text);

      expect(result).toBe('{"name": "test"}');
    });

    it('should extract JSON preceded by text', () => {
      const text = 'Here is the response: {"status": "ok"}';

      const result = extractJSON(text);

      expect(result).toBe('{"status": "ok"}');
    });

    it('should extract JSON followed by explanatory text', () => {
      const text = '{"status": "ok"} This is the response.';

      const result = extractJSON(text);

      expect(result).toBe('{"status": "ok"}');
    });

    it('should handle nested JSON objects', () => {
      const text = '{"outer": {"inner": {"deep": "value"}}}';

      const result = extractJSON(text);

      expect(result).toBe('{"outer": {"inner": {"deep": "value"}}}');
    });

    it('should handle JSON arrays', () => {
      const text = '{"items": [1, 2, 3]}';

      const result = extractJSON(text);

      expect(result).toBe('{"items": [1, 2, 3]}');
    });

    it('should handle escaped quotes in strings', () => {
      const text = '{"message": "He said \\"hello\\""}';

      const result = extractJSON(text);

      expect(result).toBe('{"message": "He said \\"hello\\""}');
    });

    it('should handle empty JSON object', () => {
      const text = '{}';

      const result = extractJSON(text);

      expect(result).toBe('{}');
    });

    it('should return empty object when no JSON found', () => {
      const text = 'No JSON here at all';

      const result = extractJSON(text);

      expect(result).toBe('{}');
    });

    it('should strip markdown code block markers', () => {
      const text = '```json\n{"key": "value"}\n```';

      const result = extractJSON(text);

      expect(result).toBe('{"key": "value"}');
    });

    it('should handle backticks without json label', () => {
      const text = '```\n{"status": "ok"}\n```';

      const result = extractJSON(text);

      expect(result).toBe('{"status": "ok"}');
    });

    it('should extract JSON from AI response with preamble', () => {
      const text = 'Based on the logs, here is my analysis:\n\n{"severity": "high", "summary": "CPU spike"}';

      const result = extractJSON(text);

      expect(result).toBe('{"severity": "high", "summary": "CPU spike"}');
    });

    it('should handle JSON with boolean values', () => {
      const text = '{"enabled": true, "disabled": false}';

      const result = extractJSON(text);

      expect(result).toBe('{"enabled": true, "disabled": false}');
    });

    it('should handle JSON with null values', () => {
      const text = '{"value": null}';

      const result = extractJSON(text);

      expect(result).toBe('{"value": null}');
    });

    it('should handle JSON with numeric values', () => {
      const text = '{"count": 42, "ratio": 0.85, "negative": -10}';

      const result = extractJSON(text);

      expect(result).toBe('{"count": 42, "ratio": 0.85, "negative": -10}');
    });

    it('should handle complex nested structure', () => {
      const text = `{
        "outer": {
          "middle": [
            {"key": "value"},
            {"key2": "value2"}
          ]
        }
      }`;

      const result = extractJSON(text);

      expect(JSON.parse(result)).toBeDefined();
      expect(JSON.parse(result).outer.middle).toHaveLength(2);
    });
  });

  describe('parseAIJSON', () => {
    it('should parse valid JSON string', () => {
      const text = '{"name": "test", "value": 42}';

      const result = parseAIJSON(text);

      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should parse JSON from markdown blocks', () => {
      const text = '```json\n{"status": "ok"}\n```';

      const result = parseAIJSON(text);

      expect(result).toEqual({ status: 'ok' });
    });

    it('should parse JSON with array', () => {
      const text = '{"items": [1, 2, 3]}';

      const result = parseAIJSON(text);

      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('should parse JSON with nested objects', () => {
      const text = '{"user": {"name": "John", "age": 30}}';

      const result = parseAIJSON(text);

      expect(result.user.name).toBe('John');
      expect(result.user.age).toBe(30);
    });

    it('should throw on invalid JSON', () => {
      const text = 'not valid json {]';

      expect(() => parseAIJSON(text)).toThrow();
    });

    it('should parse JSON from AI response with preamble', () => {
      const text = 'Analysis result:\n\n{"status": "healthy", "cpu": 45}';

      const result = parseAIJSON(text);

      expect(result).toEqual({ status: 'healthy', cpu: 45 });
    });

    it('should return generic object when type not specified', () => {
      const text = '{"key": "value"}';

      const result = parseAIJSON(text);

      expect(typeof result).toBe('object');
      expect(result.key).toBe('value');
    });

    it('should parse JSON with special characters in strings', () => {
      const text = '{"message": "Error: Something went wrong!"}';

      const result = parseAIJSON(text);

      expect(result.message).toBe('Error: Something went wrong!');
    });
  });

  describe('parseAIJSONTyped', () => {
    it('should parse JSON with type checking (valid type)', () => {
      const text = '{"severity": "high", "count": 5}';
      const typeCheck = (obj: unknown): obj is { severity: string; count: number } => {
        return (
          typeof obj === 'object' &&
          obj !== null &&
          'severity' in obj &&
          'count' in obj
        );
      };

      const result = parseAIJSONTyped(text, typeCheck);

      expect(result).toEqual({ severity: 'high', count: 5 });
    });

    it('should throw when type check fails', () => {
      const text = '{"status": "ok"}';
      const typeCheck = (obj: unknown): obj is { severity: string } => {
        return typeof obj === 'object' && obj !== null && 'severity' in obj;
      };

      expect(() => parseAIJSONTyped(text, typeCheck)).toThrow('does not match expected type');
    });

    it('should parse without type check when typeCheck omitted', () => {
      const text = '{"data": "value"}';

      const result = parseAIJSONTyped(text);

      expect(result).toEqual({ data: 'value' });
    });

    it('should parse complex objects with type validation', () => {
      const text = `{
        "predictions": [
          {"vcpu": 2, "confidence": 0.85},
          {"vcpu": 4, "confidence": 0.92}
        ]
      }`;

      const typeCheck = (obj: unknown): boolean => {
        return (
          typeof obj === 'object' &&
          obj !== null &&
          'predictions' in obj &&
          Array.isArray((obj as Record<string, unknown>).predictions)
        );
      };

      const result = parseAIJSONTyped(text, typeCheck);

      expect(result.predictions).toHaveLength(2);
    });

    it('should preserve types through parsing', () => {
      const text = '{"count": 42, "ratio": 0.5, "active": true}';
      const typeCheck = (obj: unknown): boolean => true;

      const result = parseAIJSONTyped(text, typeCheck);

      expect(typeof result.count).toBe('number');
      expect(typeof result.ratio).toBe('number');
      expect(typeof result.active).toBe('boolean');
    });
  });

  describe('Integration: Full parsing flow', () => {
    it('should handle AI response with markdown and text', () => {
      const aiResponse = `Here is my analysis:

\`\`\`json
{
  "severity": "critical",
  "anomalyType": "consensus",
  "correlations": ["L1 sync failure", "op-node stalled"],
  "predictedImpact": "Loss of finality",
  "suggestedActions": ["Restart op-node", "Check L1 connection"]
}
\`\`\`

This analysis indicates a serious issue with the consensus layer.`;

      const result = parseAIJSON(aiResponse);

      expect(result.severity).toBe('critical');
      expect(result.anomalyType).toBe('consensus');
      expect(result.suggestedActions).toHaveLength(2);
    });

    it('should handle multiple JSON parsing attempts', () => {
      const responses = [
        '{"status": "ok"}',
        '```json\n{"status": "error"}\n```',
        'Analysis: {"status": "pending"}',
      ];

      const results = responses.map(r => parseAIJSON(r));

      expect(results[0].status).toBe('ok');
      expect(results[1].status).toBe('error');
      expect(results[2].status).toBe('pending');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string', () => {
      const text = '';

      const result = extractJSON(text);

      expect(result).toBe('{}');
    });

    it('should handle whitespace only', () => {
      const text = '   \n\n  \t  ';

      const result = extractJSON(text);

      expect(result).toBe('{}');
    });

    it('should handle very long JSON', () => {
      const longArray = Array(100).fill({ id: 1, name: 'test' });
      const text = JSON.stringify({ items: longArray });

      const result = extractJSON(text);

      expect(JSON.parse(result).items).toHaveLength(100);
    });

    it('should handle JSON with unicode characters', () => {
      const text = '{"message": "hello world", "emoji": "🚀"}';

      const result = parseAIJSON(text);

      expect(result.message).toBe('hello world');
      expect(result.emoji).toBe('🚀');
    });

    it('should handle malformed markdown wrapping', () => {
      const text = '```\n```json\n{"key": "value"}\n```\n```';

      const result = extractJSON(text);

      expect(JSON.parse(result)).toEqual({ key: 'value' });
    });

    it('should handle multiple markdown blocks (extracts first JSON)', () => {
      const text = '```json\n{"first": 1}\n```\nText\n```json\n{"second": 2}\n```';

      const result = extractJSON(text);

      expect(JSON.parse(result)).toEqual({ first: 1 });
    });
  });
});
