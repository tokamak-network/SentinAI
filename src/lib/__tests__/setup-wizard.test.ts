/**
 * Setup Wizard Tests
 *
 * Tests that the setup wizard (scripts/setup.mjs):
 * 1. Exits with code 1 + error message when stdin closes prematurely
 * 2. Successfully writes .env.local when all prompts are answered
 */

import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, copyFileSync, unlinkSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CWD = resolve(__dirname, '../../..');
const SETUP_SCRIPT = resolve(CWD, 'scripts/setup.mjs');
const ENV_PATH = resolve(CWD, '.env.local');
const BACKUP_PATH = ENV_PATH + '.wizard-test-backup';

/** Strip ANSI escape codes from terminal output */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Spawn the wizard and return stdout/stderr/exit code */
function spawnWizard(): {
  child: ChildProcess;
  result: Promise<{ code: number; stdout: string; stderr: string }>;
} {
  const child = spawn('node', [SETUP_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: CWD,
  });

  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (d) => (stdout += d.toString()));
  child.stderr!.on('data', (d) => (stderr += d.toString()));

  const result = new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      child.on('close', (code) =>
        resolve({ code: code ?? 1, stdout, stderr })
      );
    }
  );

  return { child, result };
}

/**
 * Drive the wizard by matching prompts in stdout and sending responses.
 * Each response is { wait: string_to_match, send: string_to_type }.
 */
function driveWizard(
  child: ChildProcess,
  responses: Array<{ wait: string; send: string }>,
  timeoutMs = 25000
): Promise<void> {
  return new Promise((resolve, reject) => {
    let idx = 0;
    let stdout = '';
    const sent = new Set<number>();

    const timer = setTimeout(() => {
      reject(
        new Error(
          `Wizard timed out. Sent ${idx}/${responses.length} responses. ` +
            `Waiting for: "${responses[idx]?.wait}". ` +
            `Last stdout: ${stripAnsi(stdout).slice(-200)}`
        )
      );
      child.kill();
    }, timeoutMs);

    function check() {
      if (idx >= responses.length) {
        clearTimeout(timer);
        resolve();
        return;
      }
      const r = responses[idx];
      const clean = stripAnsi(stdout);
      if (clean.includes(r.wait) && !sent.has(idx)) {
        sent.add(idx);
        idx++;
        setTimeout(() => {
          child.stdin!.write(r.send + '\n');
          setTimeout(check, 100);
        }, 50);
      }
    }

    child.stdout!.on('data', (d) => {
      stdout += d.toString();
      setTimeout(check, 100);
    });
  });
}

describe('Setup Wizard', () => {
  let envBackedUp = false;

  // Backup and restore .env.local around tests
  function backupEnv() {
    if (existsSync(ENV_PATH)) {
      copyFileSync(ENV_PATH, BACKUP_PATH);
      unlinkSync(ENV_PATH);
      envBackedUp = true;
    }
  }

  function restoreEnv() {
    // Remove any test-generated .env.local
    if (existsSync(ENV_PATH) && envBackedUp) {
      unlinkSync(ENV_PATH);
    }
    // Restore backup
    if (existsSync(BACKUP_PATH)) {
      copyFileSync(BACKUP_PATH, ENV_PATH);
      unlinkSync(BACKUP_PATH);
    }
    envBackedUp = false;
  }

  afterEach(() => {
    restoreEnv();
  });

  describe('INPUT_CLOSED handling', () => {
    it('should exit with code 1 when stdin closes before wizard completes', async () => {
      const { child, result } = spawnWizard();

      // Existing .env.local means mode selection first (1=fresh), then L2 RPC
      // Send only partial input — not enough to complete all 7 steps
      child.stdin!.write('1\nhttps://rpc.test.example.com\n');
      child.stdin!.end();

      const { code, stderr } = await result;

      expect(code).toBe(1);
      expect(stripAnsi(stderr)).toContain('Input stream closed');
      expect(stripAnsi(stderr)).toContain('node scripts/setup.mjs');
    }, 20000);

    it('should exit with code 1 when stdin is immediately closed', async () => {
      const { child, result } = spawnWizard();
      child.stdin!.end(); // EOF immediately

      const { code, stderr } = await result;

      expect(code).toBe(1);
      expect(stripAnsi(stderr)).toContain('Input stream closed');
    }, 20000);
  });

  describe('successful .env.local generation', () => {
    it('should create .env.local with correct content in fresh mode', async () => {
      backupEnv();

      const { child, result } = spawnWizard();

      // Fresh mode responses (no .env.local exists → no mode selection)
      const responses = [
        { wait: 'L2_RPC_URL:', send: 'https://rpc.thanos-sepolia.tokamak.network' },
        { wait: 'Choice (1-', send: '5' }, // Skip AI
        { wait: 'EKS cluster', send: 'n' },
        { wait: 'Configure spare L1', send: 'n' },
        { wait: 'Proxyd integration', send: 'n' },
        { wait: 'Monitor EOA', send: 'n' },
        { wait: 'webhook alerts', send: 'n' },
        { wait: 'advanced settings', send: 'n' },
        { wait: 'Write to .env.local', send: 'y' },
      ];

      await driveWizard(child, responses);

      const { code } = await result;
      expect(code).toBe(0);

      // Verify .env.local was created
      expect(existsSync(ENV_PATH)).toBe(true);

      const content = readFileSync(ENV_PATH, 'utf-8');
      expect(content).toContain('L2_RPC_URL=https://rpc.thanos-sepolia.tokamak.network');
      expect(content).toContain('SentinAI Configuration');
      expect(content).toContain('Generated by setup wizard');
    }, 30000);

    it('should not create .env.local when user declines write', async () => {
      backupEnv();

      const { child, result } = spawnWizard();

      const responses = [
        { wait: 'L2_RPC_URL:', send: 'https://rpc.test.example.com' },
        { wait: 'Choice (1-', send: '5' }, // Skip AI
        { wait: 'EKS cluster', send: 'n' },
        { wait: 'Configure spare L1', send: 'n' },
        { wait: 'Proxyd integration', send: 'n' },
        { wait: 'Monitor EOA', send: 'n' },
        { wait: 'webhook alerts', send: 'n' },
        { wait: 'advanced settings', send: 'n' },
        { wait: 'Write to .env.local', send: 'n' }, // Decline
      ];

      await driveWizard(child, responses);

      const { code, stdout } = await result;
      expect(code).toBe(0);
      expect(stripAnsi(stdout)).toContain('Cancelled');

      // .env.local should NOT exist (was removed in backupEnv)
      expect(existsSync(ENV_PATH)).toBe(false);
    }, 30000);
  });
});
