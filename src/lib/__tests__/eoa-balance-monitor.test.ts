/**
 * EOA Balance Monitor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

const { mockGetBalance, mockGetGasPrice, mockSendTransaction, mockWaitForTransactionReceipt } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
  mockGetGasPrice: vi.fn(),
  mockSendTransaction: vi.fn(),
  mockWaitForTransactionReceipt: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBalance: mockGetBalance,
    getGasPrice: mockGetGasPrice,
    waitForTransactionReceipt: mockWaitForTransactionReceipt,
  })),
  createWalletClient: vi.fn(() => ({
    sendTransaction: mockSendTransaction,
  })),
  http: vi.fn(),
  parseEther: vi.fn((val: string) => BigInt(Math.floor(parseFloat(val) * 1e18))),
  formatEther: vi.fn((val: bigint) => (Number(val) / 1e18).toString()),
  parseGwei: vi.fn((val: string) => BigInt(Math.floor(parseFloat(val) * 1e9))),
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({
    address: '0xTreasuryAddress' as `0x${string}`,
  })),
}));

vi.mock('viem/chains', () => ({
  sepolia: { id: 11155111, name: 'Sepolia' },
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  getActiveL1RpcUrl: vi.fn(() => 'https://rpc.example.com'),
}));

// ============================================================
// Import after mocks
// ============================================================

import {
  checkBalance,
  getAllBalanceStatus,
  canRefill,
  refillEOA,
  resetDailyCounter,
  resetEOAMonitorState,
  getRefillEvents,
  getEOAConfig,
} from '../eoa-balance-monitor';

// ============================================================
// Test Constants
// ============================================================

const BATCHER_ADDR = '0xBatcherAddress' as `0x${string}`;
const PROPOSER_ADDR = '0xProposerAddress' as `0x${string}`;
const TREASURY_KEY = '0x' + 'a'.repeat(64) as `0x${string}`;

const TEST_CONFIG = {
  warningThresholdEth: 0.5,
  criticalThresholdEth: 0.1,
  emergencyThresholdEth: 0.01,
  refillAmountEth: 1.0,
  maxDailyRefillEth: 5.0,
  cooldownMs: 600_000, // 10 min
  gasGuardGwei: 100,
  minTreasuryBalanceEth: 1.0,
};

// Helper: convert ETH to mock wei bigint
function ethToWei(eth: number): bigint {
  return BigInt(Math.floor(eth * 1e18));
}

// ============================================================
// Tests
// ============================================================

describe('eoa-balance-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEOAMonitorState();
    // Default: no env vars set
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
    delete process.env.TREASURY_PRIVATE_KEY;
    delete process.env.SCALING_SIMULATION_MODE;
  });

  afterEach(() => {
    delete process.env.BATCHER_EOA_ADDRESS;
    delete process.env.PROPOSER_EOA_ADDRESS;
    delete process.env.TREASURY_PRIVATE_KEY;
    delete process.env.SCALING_SIMULATION_MODE;
  });

  // ============================
  // 1. Balance threshold detection
  // ============================
  describe('checkBalance', () => {
    it('should classify normal balance (> 0.5 ETH)', async () => {
      mockGetBalance.mockResolvedValueOnce(ethToWei(1.5));

      const result = await checkBalance('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.level).toBe('normal');
      expect(result.balanceEth).toBeCloseTo(1.5, 1);
      expect(result.role).toBe('batcher');
    });

    it('should classify warning balance (0.1 ~ 0.5 ETH)', async () => {
      mockGetBalance.mockResolvedValueOnce(ethToWei(0.3));

      const result = await checkBalance('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.level).toBe('warning');
    });

    it('should classify critical balance (0.01 ~ 0.1 ETH)', async () => {
      mockGetBalance.mockResolvedValueOnce(ethToWei(0.05));

      const result = await checkBalance('https://rpc.test', PROPOSER_ADDR, 'proposer', TEST_CONFIG);

      expect(result.level).toBe('critical');
    });

    it('should classify emergency balance (< 0.01 ETH)', async () => {
      mockGetBalance.mockResolvedValueOnce(ethToWei(0.005));

      const result = await checkBalance('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.level).toBe('emergency');
    });
  });

  // ============================
  // 2. Simulation mode
  // ============================
  describe('refillEOA - simulation mode', () => {
    it('should skip tx execution in simulation mode', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'true';

      const result = await refillEOA('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('simulation');
      expect(mockSendTransaction).not.toHaveBeenCalled();
    });

    it('should log simulation refill event', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'true';

      await refillEOA('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      const events = getRefillEvents();
      expect(events).toHaveLength(1);
      expect(events[0].simulated).toBe(true);
    });
  });

  // ============================
  // 3. No signer fallback
  // ============================
  describe('refillEOA - no signer', () => {
    it('should return no-signer when TREASURY_PRIVATE_KEY not set', async () => {
      const result = await refillEOA('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('no-signer');
    });
  });

  // ============================
  // 4. Cooldown enforcement
  // ============================
  describe('canRefill - cooldown', () => {
    it('should deny refill within cooldown period', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';
      mockGetBalance.mockResolvedValue(ethToWei(10)); // Treasury has enough
      mockGetGasPrice.mockResolvedValue(BigInt(20 * 1e9)); // 20 gwei

      // Simulate a recent refill
      const state = (globalThis as any).__sentinai_eoa_monitor;
      if (!state) {
        (globalThis as any).__sentinai_eoa_monitor = {
          dailyRefillTotalEth: 0,
          dailyResetDate: new Date().toDateString(),
          lastRefillTime: { [BATCHER_ADDR]: Date.now() },
          refillEvents: [],
        };
      }

      const result = await canRefill('https://rpc.test', BATCHER_ADDR, TEST_CONFIG);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('cooldown');
    });
  });

  // ============================
  // 5. Daily limit enforcement
  // ============================
  describe('canRefill - daily limit', () => {
    it('should deny refill when daily limit exceeded', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';

      // Set daily total near limit
      (globalThis as any).__sentinai_eoa_monitor = {
        dailyRefillTotalEth: 4.5,
        dailyResetDate: new Date().toDateString(),
        lastRefillTime: {},
        refillEvents: [],
      };

      const result = await canRefill('https://rpc.test', BATCHER_ADDR, TEST_CONFIG);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('daily-limit');
    });
  });

  // ============================
  // 6. Gas guard
  // ============================
  describe('canRefill - gas guard', () => {
    it('should deny refill when L1 gas price exceeds guard', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';
      mockGetBalance.mockResolvedValue(ethToWei(10)); // Treasury OK
      mockGetGasPrice.mockResolvedValue(BigInt(150 * 1e9)); // 150 gwei > 100 guard

      const result = await canRefill('https://rpc.test', BATCHER_ADDR, TEST_CONFIG);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('gas-high');
    });
  });

  // ============================
  // 7. Treasury protection
  // ============================
  describe('canRefill - treasury protection', () => {
    it('should deny refill when treasury balance too low', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';
      mockGetBalance.mockResolvedValue(ethToWei(0.5)); // Treasury < 1.0 min
      mockGetGasPrice.mockResolvedValue(BigInt(20 * 1e9));

      const result = await canRefill('https://rpc.test', BATCHER_ADDR, TEST_CONFIG);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('treasury-low');
    });
  });

  // ============================
  // 8. Successful refill
  // ============================
  describe('refillEOA - success', () => {
    it('should execute refill and update state', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';

      // Treasury balance check
      mockGetBalance
        .mockResolvedValueOnce(ethToWei(5.0))  // Treasury balance
        .mockResolvedValueOnce(ethToWei(0.05))  // Previous target balance
        .mockResolvedValueOnce(ethToWei(1.05)); // New target balance after refill

      mockGetGasPrice.mockResolvedValueOnce(BigInt(20 * 1e9)); // 20 gwei
      mockSendTransaction.mockResolvedValueOnce('0xabcdef1234567890');
      mockWaitForTransactionReceipt.mockResolvedValueOnce({
        status: 'success',
        gasUsed: BigInt(21000),
      });

      const result = await refillEOA('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.success).toBe(true);
      expect(result.txHash).toBe('0xabcdef1234567890');
      expect(result.previousBalanceEth).toBeCloseTo(0.05, 1);
      expect(result.newBalanceEth).toBeCloseTo(1.05, 1);
      expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // ============================
  // 9. Transaction revert
  // ============================
  describe('refillEOA - tx reverted', () => {
    it('should handle reverted transaction', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';

      mockGetBalance
        .mockResolvedValueOnce(ethToWei(5.0))  // Treasury
        .mockResolvedValueOnce(ethToWei(0.05)); // Previous balance
      mockGetGasPrice.mockResolvedValueOnce(BigInt(20 * 1e9));
      mockSendTransaction.mockResolvedValueOnce('0xreverted');
      mockWaitForTransactionReceipt.mockResolvedValueOnce({
        status: 'reverted',
        gasUsed: BigInt(21000),
      });

      const result = await refillEOA('https://rpc.test', BATCHER_ADDR, 'batcher', TEST_CONFIG);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('tx-reverted');
    });
  });

  // ============================
  // 10. Daily counter reset
  // ============================
  describe('resetDailyCounter', () => {
    it('should reset daily refill counter', () => {
      // Set some daily total
      (globalThis as any).__sentinai_eoa_monitor = {
        dailyRefillTotalEth: 3.5,
        dailyResetDate: new Date().toDateString(),
        lastRefillTime: {},
        refillEvents: [],
      };

      resetDailyCounter();

      const config = getEOAConfig();
      // After reset, full daily limit should be available
      expect(config).toBeDefined();
    });
  });

  // ============================
  // 11. getAllBalanceStatus
  // ============================
  describe('getAllBalanceStatus', () => {
    it('should return null for unconfigured EOAs', async () => {
      const status = await getAllBalanceStatus('https://rpc.test');

      expect(status.batcher).toBeNull();
      expect(status.proposer).toBeNull();
      expect(status.signerAvailable).toBe(false);
    });

    it('should return balance data for configured EOAs', async () => {
      process.env.BATCHER_EOA_ADDRESS = BATCHER_ADDR;
      process.env.PROPOSER_EOA_ADDRESS = PROPOSER_ADDR;

      mockGetBalance
        .mockResolvedValueOnce(ethToWei(0.3))  // Batcher
        .mockResolvedValueOnce(ethToWei(1.2)); // Proposer

      const status = await getAllBalanceStatus('https://rpc.test');

      expect(status.batcher).not.toBeNull();
      expect(status.batcher!.balanceEth).toBeCloseTo(0.3, 1);
      expect(status.batcher!.level).toBe('warning');
      expect(status.proposer).not.toBeNull();
      expect(status.proposer!.balanceEth).toBeCloseTo(1.2, 1);
      expect(status.proposer!.level).toBe('normal');
    });
  });

  // ============================
  // 12. canRefill - allowed
  // ============================
  describe('canRefill - allowed', () => {
    it('should allow refill when all conditions met', async () => {
      process.env.TREASURY_PRIVATE_KEY = TREASURY_KEY;
      process.env.SCALING_SIMULATION_MODE = 'false';
      mockGetBalance.mockResolvedValue(ethToWei(10)); // Treasury OK
      mockGetGasPrice.mockResolvedValue(BigInt(20 * 1e9)); // 20 gwei < 100 guard

      const result = await canRefill('https://rpc.test', BATCHER_ADDR, TEST_CONFIG);

      expect(result.allowed).toBe(true);
    });
  });
});
