import { describe, it, expect } from 'vitest';
import { generateTraceId, withTraceId, getTraceId } from '@/lib/trace-context';

describe('trace-context', () => {
  it('should generate unique trace IDs with tr- prefix', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).toMatch(/^tr-[a-f0-9]{16}$/);
    expect(id2).toMatch(/^tr-[a-f0-9]{16}$/);
    expect(id1).not.toBe(id2);
  });

  it('should propagate trace ID via AsyncLocalStorage', async () => {
    const traceId = 'tr-test1234567890';
    let captured: string | undefined;

    await withTraceId(traceId, async () => {
      captured = getTraceId();
    });

    expect(captured).toBe(traceId);
  });

  it('should return undefined outside trace context', () => {
    expect(getTraceId()).toBeUndefined();
  });

  it('should handle nested trace contexts', async () => {
    await withTraceId('tr-outer', async () => {
      expect(getTraceId()).toBe('tr-outer');

      await withTraceId('tr-inner', async () => {
        expect(getTraceId()).toBe('tr-inner');
      });

      // Outer context restored
      expect(getTraceId()).toBe('tr-outer');
    });
  });

  it('should propagate across async boundaries', async () => {
    const traceId = 'tr-asyncboundary1';

    await withTraceId(traceId, async () => {
      // Simulate async work (setTimeout wrapped in Promise)
      const result = await new Promise<string | undefined>((resolve) => {
        setTimeout(() => {
          resolve(getTraceId());
        }, 10);
      });
      expect(result).toBe(traceId);
    });
  });

  it('should support synchronous callbacks', () => {
    const traceId = 'tr-sync123456789';

    const result = withTraceId(traceId, () => {
      return getTraceId();
    });

    expect(result).toBe(traceId);
  });
});
