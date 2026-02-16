/**
 * Unit tests for log-ingester module
 * Tests log fetching and mock data generation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateMockLogs, getAllLiveLogs, getLiveLogs } from '@/lib/log-ingester';

// Mock k8s-config
vi.mock('@/lib/k8s-config', () => ({
  getNamespace: () => 'default',
  getAppPrefix: () => 'op',
  runK8sCommand: vi.fn(),
}));

describe('log-ingester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateMockLogs', () => {
    it('should generate normal mode logs', () => {
      const logs = generateMockLogs('normal');

      expect(logs['op-geth']).toBeTruthy();
      expect(logs['op-node']).toBeTruthy();
      expect(logs['op-batcher']).toBeTruthy();
      expect(logs['op-proposer']).toBeTruthy();
    });

    it('should generate attack mode logs', () => {
      const logs = generateMockLogs('attack');

      expect(logs['op-geth']).toContain('WARN');
      expect(logs['op-node']).toContain('WARN');
    });

    it('should have all L2 components in normal mode', () => {
      const logs = generateMockLogs('normal');

      const components = ['op-geth', 'op-node', 'op-batcher', 'op-proposer'];
      for (const comp of components) {
        expect(logs[comp]).toBeTruthy();
        expect(logs[comp]).toContain('INFO');
      }
    });

    it('should include timestamps in logs', () => {
      const logs = generateMockLogs('normal');

      const isoTimestampRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      expect(logs['op-geth']).toMatch(isoTimestampRegex);
    });

    it('should default to normal mode', () => {
      const logs = generateMockLogs();

      expect(logs['op-geth']).toContain('INFO');
    });

    it('should distinguish normal from attack mode', () => {
      const normal = generateMockLogs('normal');
      const attack = generateMockLogs('attack');

      expect(normal['op-geth']).not.toEqual(attack['op-geth']);
      expect(attack['op-geth']).toContain('WARN');
    });

    it('should have op-geth import logs in normal mode', () => {
      const logs = generateMockLogs('normal');

      expect(logs['op-geth']).toContain('Imported');
    });

    it('should have op-node derivation logs in normal mode', () => {
      const logs = generateMockLogs('normal');

      expect(logs['op-node']).toContain('Derived');
    });
  });

  describe('getLiveLogs', () => {
    it('should call runK8sCommand with kubectl', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand).mockResolvedValue({
        stdout: 'pod-name',
        stderr: '',
      });

      // Mock second call for logs
      vi.mocked(runK8sCommand)
        .mockResolvedValueOnce({ stdout: 'pod-name', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'log content', stderr: '' });

      await getLiveLogs();

      expect(runK8sCommand).toHaveBeenCalled();
    });

    it('should return log content', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand)
        .mockResolvedValueOnce({ stdout: 'pod-name', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'Log line 1\nLog line 2', stderr: '' });

      const result = await getLiveLogs();

      expect(result).toContain('Log');
    });

    it('should handle kubectl error gracefully', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand).mockRejectedValue(new Error('command not found'));

      const result = await getLiveLogs();

      expect(result).toContain('ERROR');
    });

    it('should handle empty pod list', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand).mockResolvedValue({
        stdout: '',
        stderr: '',
      });

      const result = await getLiveLogs();

      expect(result).toContain('WARN');
    });

    it('should use custom namespace', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand)
        .mockResolvedValueOnce({ stdout: 'pod-name', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'logs', stderr: '' });

      await getLiveLogs('custom-ns');

      expect(runK8sCommand).toHaveBeenCalledWith(
        expect.stringContaining('custom-ns')
      );
    });

    it('should use custom label selector', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand)
        .mockResolvedValueOnce({ stdout: 'pod-name', stderr: '' })
        .mockResolvedValueOnce({ stdout: 'logs', stderr: '' });

      await getLiveLogs(undefined, 'app=custom-label');

      expect(runK8sCommand).toHaveBeenCalledWith(
        expect.stringContaining('custom-label')
      );
    });
  });

  describe('getAllLiveLogs', () => {
    it('should fetch logs from all L2 components', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      // Mock implementation that handles both get pods and logs commands
      vi.mocked(runK8sCommand).mockImplementation(async (cmd: string) => {
        // First type of call: get pods (returns pod name)
        if (cmd.includes('get pods')) {
          if (cmd.includes('op-geth')) return { stdout: 'op-geth-pod', stderr: '' };
          if (cmd.includes('op-node')) return { stdout: 'op-node-pod', stderr: '' };
          if (cmd.includes('op-batcher')) return { stdout: 'op-batcher-pod', stderr: '' };
          if (cmd.includes('op-proposer')) return { stdout: 'op-proposer-pod', stderr: '' };
        }

        // Second type of call: logs (returns actual logs)
        if (cmd.includes('logs')) {
          if (cmd.includes('op-geth')) return { stdout: 'geth logs content', stderr: '' };
          if (cmd.includes('op-node')) return { stdout: 'node logs content', stderr: '' };
          if (cmd.includes('op-batcher')) return { stdout: 'batcher logs content', stderr: '' };
          if (cmd.includes('op-proposer')) return { stdout: 'proposer logs content', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      });

      const result = await getAllLiveLogs();

      expect(Object.keys(result)).toHaveLength(4);
      expect(result['op-geth']).toContain('geth');
      expect(result['op-node']).toContain('node');
      expect(result['op-batcher']).toContain('batcher');
      expect(result['op-proposer']).toContain('proposer');
    });

    it('should handle partial failures gracefully', async () => {
      const { runK8sCommand } = await import('@/lib/k8s-config');

      vi.mocked(runK8sCommand).mockImplementation(async (cmd: string) => {
        // op-node fails on logs command
        if (cmd.includes('op-node') && cmd.includes('logs')) {
          throw new Error('Failed to fetch logs for op-node');
        }

        // get pods commands: return pod names
        if (cmd.includes('get pods')) {
          if (cmd.includes('op-geth')) return { stdout: 'op-geth-pod', stderr: '' };
          if (cmd.includes('op-node')) return { stdout: 'op-node-pod', stderr: '' };
          if (cmd.includes('op-batcher')) return { stdout: 'op-batcher-pod', stderr: '' };
          if (cmd.includes('op-proposer')) return { stdout: 'op-proposer-pod', stderr: '' };
        }

        // logs commands: return content (op-node already fails above)
        if (cmd.includes('logs')) {
          if (cmd.includes('op-geth')) return { stdout: 'geth logs', stderr: '' };
          if (cmd.includes('op-batcher')) return { stdout: 'batcher logs', stderr: '' };
          if (cmd.includes('op-proposer')) return { stdout: 'proposer logs', stderr: '' };
        }

        return { stdout: '', stderr: '' };
      });

      const result = await getAllLiveLogs();

      expect(result['op-geth']).toContain('geth');
      expect(result['op-node']).toContain('ERROR');
      expect(result['op-batcher']).toContain('batcher');
      expect(result['op-proposer']).toContain('proposer');
    });
  });

  describe('Integration', () => {
    it('should generate consistent mock logs', () => {
      const logs1 = generateMockLogs('normal');
      const logs2 = generateMockLogs('normal');

      // Both should have INFO logs
      expect(logs1['op-geth']).toContain('INFO');
      expect(logs2['op-geth']).toContain('INFO');
    });
  });

  describe('Edge Cases', () => {
    it('should handle all 4 components', () => {
      const logs = generateMockLogs('normal');

      const componentCount = Object.keys(logs).length;
      expect(componentCount).toBe(4);
    });

    it('should handle attack mode with all components', () => {
      const logs = generateMockLogs('attack');

      expect(logs['op-geth']).toBeTruthy();
      expect(logs['op-node']).toBeTruthy();
    });
  });
});
