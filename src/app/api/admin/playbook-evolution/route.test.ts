/**
 * Playbook Evolution API Tests
 *
 * Tests for GET /api/admin/playbook-evolution (current version)
 * and POST /api/admin/playbook-evolution (trigger evolution or rollback)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import type { EvolvedPlaybook, PlaybookVersion } from '@/lib/types/playbook-evolution';

const SENTINAI_API_KEY = 'test-api-key-12345';

// Mock state store and redis
let mockRedis: any;
let mockStore: any;

vi.mock('@/core/redis', () => {
  return {
    getCoreRedis: () => mockRedis,
  };
});

vi.mock('@/lib/redis-store', () => {
  return {
    getStore: () => mockStore,
  };
});

// Mock RollbackManager
vi.mock('@/lib/playbook-evolution/rollback-manager', () => {
  return {
    RollbackManager: class {
      async getVersionHistory() {
        return mockStore.__versionHistory || { current: {}, history: [] };
      }

      async getCurrentVersion() {
        return mockStore.__currentVersion || null;
      }

      async promoteVersion(playbook: any) {
        return {
          isOk: () => true,
          isErr: () => false,
          unwrap: () => ({ versionId: playbook.versionId, playbook, promotedAt: new Date(), isActive: true }),
          getError: () => null,
        };
      }

      async rollbackToVersion(versionId: string) {
        return mockStore.__rollbackResult || { isOk: () => false, isErr: () => true };
      }
    },
  };
});

// Mock PatternMiner
vi.mock('@/lib/playbook-evolution/pattern-miner', () => {
  return {
    PatternMiner: class {
      async analyzeAndEvolve() {
        return mockStore.__patterns || null;
      }
    },
  };
});

// Mock PlaybookEvolver (LLM-enhanced generation)
vi.mock('@/lib/playbook-evolution/playbook-evolver', () => {
  return {
    PlaybookEvolver: class {
      async generate(patterns: any[], parentVersionId: string) {
        const vNum = parseInt(parentVersionId.replace('v-', ''), 10) || 0;
        return {
          isOk: () => true,
          isErr: () => false,
          unwrap: () => ({
            id: 'pb-llm-1',
            name: 'LLM Generated Playbook',
            description: 'Generated from patterns',
            actions: [{ type: 'scale', target: 'op-geth', params: {}, timeout: 30000 }],
            fallbacks: [],
            timeout: 60000,
            versionId: `v-${vNum + 1}`,
            parentVersionId,
            generatedAt: new Date(),
            generatedBy: 'anthropic/claude-sonnet-4-5-20250929',
            confidenceSource: 'llm_generation',
            generationPromptUsage: { inputTokens: 500, outputTokens: 200, totalCost: 0.004 },
            patternContext: { patterns, successRateBaseline: 85 },
          }),
          getError: () => null,
        };
      }
    },
  };
});

describe('Playbook Evolution API', () => {
  beforeEach(() => {
    process.env.SENTINAI_API_KEY = SENTINAI_API_KEY;
    mockRedis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
    mockStore = {};
  });

  describe('GET /api/admin/playbook-evolution', () => {
    it('should return current version and history with authentication', async () => {
      const mockPlaybook: EvolvedPlaybook = {
        id: 'pb-1',
        name: 'Test Playbook',
        description: 'Test',
        actions: [{ type: 'scale', target: 'pods', params: {}, timeout: 300 }],
        fallbacks: [],
        timeout: 600,
        versionId: 'v-1',
        parentVersionId: 'v-0',
        generatedAt: new Date(),
        generatedBy: 'llm_generation',
        confidenceSource: 'llm_generation',
        generationPromptUsage: { inputTokens: 100, outputTokens: 50, totalCost: 0.01 },
        patternContext: { patterns: [], successRateBaseline: 75 },
      };

      const mockVersion: PlaybookVersion = {
        versionId: 'v-1',
        playbook: mockPlaybook,
        promotedAt: new Date('2026-03-15T10:30:00Z'),
        isActive: true,
      };

      mockStore.__versionHistory = {
        current: mockVersion,
        history: [
          {
            versionId: 'v-0',
            playbook: mockPlaybook,
            promotedAt: new Date('2026-03-14T10:30:00Z'),
            isActive: false,
          },
        ],
      };

      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${SENTINAI_API_KEY}` },
      });

      const response = await GET(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data).toHaveProperty('current');
      expect(data).toHaveProperty('history');
      expect(data.current.versionId).toBe('v-1');
      expect(data.timestamp).toBeDefined();
    });

    it('should fail without authentication', async () => {
      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, { method: 'GET' });

      const response = await GET(request);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('should fail with wrong API key', async () => {
      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { Authorization: 'Bearer wrong-key' },
      });

      const response = await GET(request);
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/admin/playbook-evolution', () => {
    it('should trigger evolution and return patterns', async () => {
      mockStore.__patterns = [
        {
          anomalyType: 'high_memory',
          effectiveAction: 'scale_up',
          successRate: 85,
          executionCount: 20,
          avgDuration: 2500,
          correlationStrength: 0.9,
        },
      ];

      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SENTINAI_API_KEY}` },
        body: JSON.stringify({ action: 'trigger_evolution' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.action).toBe('evolution_triggered');
      expect(data).toHaveProperty('patterns');
      expect(data.timestamp).toBeDefined();
    });

    it('should rollback to a specific version', async () => {
      const mockPlaybook: EvolvedPlaybook = {
        id: 'pb-1',
        name: 'Test Playbook',
        description: 'Test',
        actions: [],
        fallbacks: [],
        timeout: 600,
        versionId: 'v-0',
        parentVersionId: 'v-neg1',
        generatedAt: new Date(),
        generatedBy: 'human_authored',
        confidenceSource: 'human_authored',
        generationPromptUsage: { inputTokens: 0, outputTokens: 0, totalCost: 0 },
        patternContext: { patterns: [], successRateBaseline: 70 },
      };

      const mockVersion: PlaybookVersion = {
        versionId: 'v-0',
        playbook: mockPlaybook,
        promotedAt: new Date('2026-03-14T10:30:00Z'),
        isActive: true,
      };

      mockStore.__rollbackResult = {
        isOk: () => true,
        isErr: () => false,
        unwrap: () => mockVersion,
      };

      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SENTINAI_API_KEY}` },
        body: JSON.stringify({ action: 'rollback', versionId: 'v-0' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.action).toBe('rollback_completed');
      expect(data.playbook.versionId).toBe('v-0');
      expect(data.timestamp).toBeDefined();
    });

    it('should reject unknown action', async () => {
      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SENTINAI_API_KEY}` },
        body: JSON.stringify({ action: 'invalid_action' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Unknown action');
    });

    it('should fail rollback with non-existent version', async () => {
      mockStore.__rollbackResult = {
        isOk: () => false,
        isErr: () => true,
        getError: () => new Error('404 Not Found: version v-999 not found in history'),
      };

      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${SENTINAI_API_KEY}` },
        body: JSON.stringify({ action: 'rollback', versionId: 'v-999' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);

      const data = await response.json();
      expect(data.error).toContain('Version not found');
    });

    it('should fail without authentication', async () => {
      const url = new URL('http://localhost:3000/api/admin/playbook-evolution');
      const request = new NextRequest(url, {
        method: 'POST',
        body: JSON.stringify({ action: 'trigger_evolution' }),
      });

      const response = await POST(request);
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });
  });
});
