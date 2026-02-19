/**
 * Dispute Game Monitor (Phase 2)
 * On-chain monitoring for OP Stack Fault Proof dispute games
 * 
 * Features:
 * - Track active dispute games
 * - Alert on deadline proximity
 * - Monitor game resolution status
 * - Integrate with Bond Manager for claims
 */

import { createPublicClient, http, type Address, type Chain } from 'viem';

// ============================================================
// Types
// ============================================================

export interface DisputeGame {
  gameId: string;
  gameType: string;
  status: 'in-progress' | 'challenger-win' | 'proposer-win' | 'timeout';
  rootClaim: string;
  challenger: Address;
  proposer: Address;
  bond: bigint;
  createdAt: number;  // timestamp
  deadline: number;   // timestamp
  l1BlockNumber: bigint;
}

export interface DisputeGameAlert {
  type: 'deadline-near' | 'game-resolved' | 'bond-claimable';
  severity: 'low' | 'medium' | 'high' | 'critical';
  gameId: string;
  message: string;
  deadline?: number;
  winner?: Address;
}

// ============================================================
// Dispute Game Monitor
// ============================================================

export class DisputeGameMonitor {
  private client: ReturnType<typeof createPublicClient>;
  private gameFactoryAddress?: Address;
  private challengerAddress?: Address;

  constructor(
    l1Chain: Chain,
    l1RpcUrl: string,
    gameFactoryAddress?: Address,
    challengerAddress?: Address,
  ) {
    this.client = createPublicClient({
      chain: l1Chain,
      transport: http(l1RpcUrl),
    });
    this.gameFactoryAddress = gameFactoryAddress;
    this.challengerAddress = challengerAddress;
  }

  /**
   * Fetch active dispute games from L1 contract
   * Phase 2: Skeleton implementation (requires DisputeGameFactory ABI)
   */
  async fetchActiveGames(): Promise<DisputeGame[]> {
    if (!this.gameFactoryAddress) {
      console.warn('[DisputeGameMonitor] DISPUTE_GAME_FACTORY_ADDRESS not configured');
      return [];
    }

    // TODO: Implement contract read using DisputeGameFactory ABI
    // - Read gameCount()
    // - For each game: read gameAtIndex(i), status, bond, deadline
    // - Filter for in-progress games

    // Skeleton: return empty for now
    return [];
  }

  /**
   * Check for games with approaching deadlines
   * Returns alerts for games < threshold hours from deadline
   */
  async checkDeadlines(thresholdHours: number = 24): Promise<DisputeGameAlert[]> {
    const activeGames = await this.fetchActiveGames();
    const now = Math.floor(Date.now() / 1000);
    const thresholdSeconds = thresholdHours * 3600;
    
    const alerts: DisputeGameAlert[] = [];

    for (const game of activeGames) {
      const timeUntilDeadline = game.deadline - now;
      
      if (timeUntilDeadline < 0) {
        // Deadline passed
        alerts.push({
          type: 'deadline-near',
          severity: 'critical',
          gameId: game.gameId,
          message: `Game ${game.gameId} deadline has passed! Manual intervention required.`,
          deadline: game.deadline,
        });
      } else if (timeUntilDeadline < 3600) {
        // < 1 hour
        alerts.push({
          type: 'deadline-near',
          severity: 'critical',
          gameId: game.gameId,
          message: `Game ${game.gameId} deadline in ${Math.floor(timeUntilDeadline / 60)} minutes`,
          deadline: game.deadline,
        });
      } else if (timeUntilDeadline < thresholdSeconds) {
        // < threshold hours
        alerts.push({
          type: 'deadline-near',
          severity: 'high',
          gameId: game.gameId,
          message: `Game ${game.gameId} deadline in ${Math.floor(timeUntilDeadline / 3600)} hours`,
          deadline: game.deadline,
        });
      }
    }

    return alerts;
  }

  /**
   * Check for games where challenger won and bond is claimable
   */
  async checkClaimableBonds(): Promise<DisputeGameAlert[]> {
    if (!this.challengerAddress) {
      return [];
    }

    // TODO: Implement contract read
    // - Query resolved games
    // - Filter for challenger wins
    // - Check if bond already claimed
    // - Return alert list

    return [];
  }

  /**
   * Get dispute game statistics
   */
  async getStatistics() {
    const activeGames = await this.fetchActiveGames();
    
    // TODO: Query historical games for win/loss stats
    
    return {
      activeGames: activeGames.length,
      totalBondsLocked: activeGames.reduce((sum, g) => sum + g.bond, 0n),
      gamesNearDeadline: activeGames.filter(g => {
        const now = Math.floor(Date.now() / 1000);
        return (g.deadline - now) < 86400; // < 24h
      }).length,
    };
  }
}

// ============================================================
// Export singleton factory
// ============================================================

let monitorInstance: DisputeGameMonitor | null = null;

export function getDisputeGameMonitor(
  l1Chain: Chain,
  l1RpcUrl: string,
  gameFactoryAddress?: Address,
  challengerAddress?: Address,
): DisputeGameMonitor {
  if (!monitorInstance) {
    monitorInstance = new DisputeGameMonitor(
      l1Chain,
      l1RpcUrl,
      gameFactoryAddress,
      challengerAddress,
    );
  }
  return monitorInstance;
}
