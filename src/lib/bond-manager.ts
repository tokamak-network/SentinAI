/**
 * Bond Manager (Phase 2)
 * Manages challenger bond deposits and claims for dispute games
 * 
 * Features:
 * - Track bond requirements
 * - Automatic bond claims after game resolution
 * - Alert on unclaimed bonds
 * - Coordinate with Treasury for refills
 */

import { createWalletClient, createPublicClient, http, type Address, type Chain, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================
// Types
// ============================================================

export interface BondStatus {
  totalBondsLocked: bigint;
  unclaimedBonds: bigint;
  availableForClaim: BondClaim[];
  estimatedRequiredBalance: bigint;
}

export interface BondClaim {
  gameId: string;
  amount: bigint;
  gameResolvedAt: number;
  claimableAfter: number;
}

// ============================================================
// Bond Manager
// ============================================================

export class BondManager {
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient?: ReturnType<typeof createWalletClient>;
  private challengerAddress?: Address;
  private gameFactoryAddress?: Address;

  constructor(
    l1Chain: Chain,
    l1RpcUrl: string,
    challengerPrivateKey?: string,
    gameFactoryAddress?: Address,
  ) {
    this.publicClient = createPublicClient({
      chain: l1Chain,
      transport: http(l1RpcUrl),
    });

    if (challengerPrivateKey) {
      const account = privateKeyToAccount(challengerPrivateKey as `0x${string}`);
      this.challengerAddress = account.address;
      
      this.walletClient = createWalletClient({
        chain: l1Chain,
        transport: http(l1RpcUrl),
        account,
      });
    }

    this.gameFactoryAddress = gameFactoryAddress;
  }

  /**
   * Calculate required bond balance for safe operation
   * Assumes 5-10 concurrent games possible
   */
  calculateRequiredBalance(bondPerGame: bigint = parseEther('0.08')): bigint {
    const maxConcurrentGames = 10n;
    const gasReserve = parseEther('0.2'); // Gas for claims/disputes
    return bondPerGame * maxConcurrentGames + gasReserve;
  }

  /**
   * Get current bond status
   */
  async getBondStatus(): Promise<BondStatus> {
    // TODO: Implement contract reads
    // - Query all games where challenger is participant
    // - Sum locked bonds (in-progress games)
    // - Find resolved games with unclaimed bonds
    // - Calculate claimable amounts

    return {
      totalBondsLocked: 0n,
      unclaimedBonds: 0n,
      availableForClaim: [],
      estimatedRequiredBalance: this.calculateRequiredBalance(),
    };
  }

  /**
   * Claim bonds from won games
   * Phase 2: Auto-claim implementation
   */
  async claimWonGames(): Promise<{ success: boolean; claimed: string[]; errors: string[] }> {
    if (!this.walletClient || !this.challengerAddress) {
      console.warn('[BondManager] No wallet configured for bond claims');
      return { success: false, claimed: [], errors: ['No wallet configured'] };
    }

    if (!this.gameFactoryAddress) {
      console.warn('[BondManager] DISPUTE_GAME_FACTORY_ADDRESS not set');
      return { success: false, claimed: [], errors: ['Factory address missing'] };
    }

    const status = await this.getBondStatus();
    const claimed: string[] = [];
    const errors: string[] = [];

    for (const claim of status.availableForClaim) {
      try {
        // TODO: Call DisputeGameFactory.claimCredit(gameId)
        // - Estimate gas
        // - Send transaction
        // - Wait for confirmation
        
        console.log(`[BondManager] Would claim bond for game ${claim.gameId}: ${claim.amount} ETH`);
        claimed.push(claim.gameId);
      } catch (error) {
        const err = error as Error;
        console.error(`[BondManager] Failed to claim bond for game ${claim.gameId}:`, err.message);
        errors.push(`${claim.gameId}: ${err.message}`);
      }
    }

    return {
      success: errors.length === 0,
      claimed,
      errors,
    };
  }

  /**
   * Check if challenger has sufficient balance for bond requirements
   */
  async checkBondSufficiency(): Promise<{
    sufficient: boolean;
    currentBalance: bigint;
    required: bigint;
    shortfall?: bigint;
  }> {
    if (!this.challengerAddress) {
      return {
        sufficient: false,
        currentBalance: 0n,
        required: this.calculateRequiredBalance(),
      };
    }

    const balance = await this.publicClient.getBalance({
      address: this.challengerAddress,
    });

    const required = this.calculateRequiredBalance();
    const sufficient = balance >= required;

    return {
      sufficient,
      currentBalance: balance,
      required,
      shortfall: sufficient ? undefined : required - balance,
    };
  }

  /**
   * Alert on unclaimed bonds older than threshold
   * Returns array of alerts for bonds unclaimed > hours threshold
   */
  async checkUnclaimedBonds(thresholdHours: number = 24): Promise<BondClaim[]> {
    const status = await this.getBondStatus();
    const now = Math.floor(Date.now() / 1000);
    const threshold = now - thresholdHours * 3600;

    return status.availableForClaim.filter(
      claim => claim.gameResolvedAt < threshold
    );
  }
}

// ============================================================
// Export singleton factory
// ============================================================

let managerInstance: BondManager | null = null;

export function getBondManager(
  l1Chain: Chain,
  l1RpcUrl: string,
  challengerPrivateKey?: string,
  gameFactoryAddress?: Address,
): BondManager {
  if (!managerInstance) {
    managerInstance = new BondManager(
      l1Chain,
      l1RpcUrl,
      challengerPrivateKey,
      gameFactoryAddress,
    );
  }
  return managerInstance;
}
