import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to make mockExec available in vi.mock factory
const { mockExec } = vi.hoisted(() => {
  return { mockExec: vi.fn() };
});

vi.mock('child_process', () => ({
  exec: mockExec,
}));

vi.mock('util', () => ({
  promisify: () => {
    return (cmd: string, opts: Record<string, unknown>) => {
      return new Promise((resolve, reject) => {
        mockExec(cmd, opts, (err: Error | null, stdout: string, stderr: string) => {
          if (err) reject(err);
          else resolve({ stdout, stderr });
        });
      });
    };
  },
}));

import { runK8sCommand, clearK8sConfigCache } from '../k8s-config';

describe('k8s-config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    clearK8sConfigCache();
    process.env = {
      ...originalEnv,
      AWS_CLUSTER_NAME: undefined,
      K8S_API_URL: undefined,
      K8S_TOKEN: undefined,
      KUBECONFIG: undefined,
      AWS_REGION: undefined,
      AWS_DEFAULT_REGION: undefined,
      K8S_INSECURE_TLS: undefined,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('runK8sCommand', () => {
    it('should execute basic kubectl command', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, 'command output', '');
        }
      );

      const result = await runK8sCommand('get pods');

      expect(result.stdout).toBe('command output');
      expect(result.stderr).toBe('');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('kubectl get pods'),
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should pipe stdin content when provided', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, 'applied', '');
        }
      );

      const manifest = '{"apiVersion":"v1","kind":"Pod"}';
      await runK8sCommand('apply -f - -n default', { stdin: manifest });

      const calledCmd = mockExec.mock.calls[0][0] as string;
      expect(calledCmd).toContain("echo '");
      expect(calledCmd).toContain('| kubectl apply -f - -n default');
      expect(calledCmd).toContain(manifest);
    });

    it('should escape single quotes in stdin', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, 'applied', '');
        }
      );

      const manifestWithQuotes = "{'name':'test'}";
      await runK8sCommand('apply -f -', { stdin: manifestWithQuotes });

      const calledCmd = mockExec.mock.calls[0][0] as string;
      // Single quotes should be escaped as '\''
      expect(calledCmd).toContain("'\\''");
    });

    it('should use custom timeout when provided', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        }
      );

      await runK8sCommand('get pods', { timeout: 30000 });

      const calledOpts = mockExec.mock.calls[0][1] as { timeout: number };
      expect(calledOpts.timeout).toBe(30000);
    });

    it('should use default timeout (10s) when not specified', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        }
      );

      await runK8sCommand('get pods');

      const calledOpts = mockExec.mock.calls[0][1] as { timeout: number };
      expect(calledOpts.timeout).toBe(10000);
    });

    it('should throw on command failure', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(new Error('kubectl failed'), '', 'error output');
        }
      );

      await expect(runK8sCommand('get pods')).rejects.toThrow('kubectl failed');
    });

    it('should not use echo pipe when stdin is not provided', async () => {
      mockExec.mockImplementation(
        (_cmd: string, _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
          cb(null, '', '');
        }
      );

      await runK8sCommand('get pods -n default');

      const calledCmd = mockExec.mock.calls[0][0] as string;
      expect(calledCmd).not.toContain('echo');
      expect(calledCmd).not.toContain('|');
    });
  });
});
