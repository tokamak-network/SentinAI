import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetRecentMetrics = vi.fn();

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    getRecentMetrics: mockGetRecentMetrics,
  }),
}));

// Import after mock
const { GET } = await import('./route');

describe('GET /api/metrics/history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRecentMetrics.mockResolvedValue([
      { timestamp: '2026-03-03T10:00:00Z', cpuUsage: 45, gasUsedRatio: 0.5, txPoolPending: 100, blockHeight: 1000, blockInterval: 2, currentVcpu: 2 },
      { timestamp: '2026-03-03T10:01:00Z', cpuUsage: 50, gasUsedRatio: 0.6, txPoolPending: 120, blockHeight: 1001, blockInterval: 2, currentVcpu: 2 },
      { timestamp: '2026-03-03T10:02:00Z', cpuUsage: 55, gasUsedRatio: 0.7, txPoolPending: 150, blockHeight: 1002, blockInterval: 2, currentVcpu: 2 },
    ]);
  });

  it('should return metrics for default 1h duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history');
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.metrics).toBeDefined();
    expect(data.metrics).toHaveLength(3);
    expect(data.duration).toBe('1h');
    expect(data.count).toBe(3);
    expect(data.maxAvailable).toBe(60);
    expect(mockGetRecentMetrics).toHaveBeenCalledWith(60);
  });

  it('should support 15m duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=15m');
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.duration).toBe('15m');
    expect(mockGetRecentMetrics).toHaveBeenCalledWith(15);
  });

  it('should support 30m duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=30m');
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.duration).toBe('30m');
    expect(mockGetRecentMetrics).toHaveBeenCalledWith(30);
  });

  it('should support 1h duration explicitly', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=1h');
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.duration).toBe('1h');
    expect(mockGetRecentMetrics).toHaveBeenCalledWith(60);
  });

  it('should return 400 for invalid duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=2h');
    const response = await GET(request as any);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain('Invalid duration');
    expect(data.error).toContain('15m');
    expect(data.error).toContain('30m');
    expect(data.error).toContain('1h');
  });

  it('should return empty array when no metrics available', async () => {
    mockGetRecentMetrics.mockResolvedValue([]);

    const request = new Request('http://localhost:3002/api/metrics/history');
    const response = await GET(request as any);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.metrics).toEqual([]);
    expect(data.count).toBe(0);
  });

  it('should return 500 on store error', async () => {
    mockGetRecentMetrics.mockRejectedValue(new Error('Store connection failed'));

    const request = new Request('http://localhost:3002/api/metrics/history');
    const response = await GET(request as any);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });
});
