# Proposal 18: EBS GP3 Dynamic IOPS Tuning

## 1. Overview

### Problem Statement

op-geth stores L2 chain data on Amazon EBS volumes. These volumes have different IOPS demands across operating phases:

| Phase | Actual IOPS | Duration | Frequency |
|-------|------------|----------|-----------|
| Initial chain sync | 6,000-10,000 | Hours-Days | Once |
| Normal operation | 200-800 | Continuous | Always |
| Block reorganization | 3,000-5,000 | Minutes | Rare |
| State pruning | 4,000-8,000 | Hours | Periodic |

GP3 volumes provide 3,000 baseline IOPS for free. Additional provisioned IOPS cost $0.0065/IOPS-month. Many operators provision 6,000+ IOPS permanently "just in case", paying ~$19.50/month for IOPS that are used <5% of the time.

### Solution Summary

Implement an **EBS IOPS Optimizer** that:
1. Monitors actual IOPS usage via CloudWatch metrics (`VolumeReadOps`, `VolumeWriteOps`)
2. Dynamically adjusts GP3 provisioned IOPS based on actual demand
3. Respects AWS constraints (6-hour cooldown between modifications, max 16,000 IOPS)
4. Proactively scales up IOPS when high I/O patterns are detected

### Goals

- Reduce EBS costs by ~$21/month (eliminating unnecessary provisioned IOPS)
- Automatically scale IOPS up during sync/reorg events
- Zero manual intervention after configuration
- Never cause I/O throttling during critical operations

### Non-Goals

- Volume type migration (GP2 → GP3 conversion)
- EBS snapshot lifecycle management
- Cross-AZ volume replication
- Throughput tuning (kept at 125 MB/s baseline unless IOPS > 3,000)

### Monthly Savings Estimate

| Item | Before (6,000 IOPS fixed) | After (dynamic) | Savings |
|------|--------------------------|------------------|---------|
| Additional IOPS | $19.50/mo (3,000 extra) | $3.30/mo (avg 500 extra) | **$16/mo** |
| Additional Throughput | $4.80/mo | $0/mo (baseline) | **$5/mo** |
| **Total** | | | **~$21/mo** |

---

## 2. Architecture

### Data Flow

```
┌─ Scheduler (NEW cron: every 60 min) ─────────────────────┐
│                                                           │
│  EBS IOPS Optimizer                                       │
│       │                                                   │
│       ├─> getEbsVolumeId()                                │
│       │   └─> aws ec2 describe-volumes                    │
│       │       --filters Name=tag:kubernetes.io/created-for │
│       │                                                   │
│       ├─> getIopsMetrics()                                │
│       │   └─> aws cloudwatch get-metric-statistics        │
│       │       --metric-name VolumeReadOps,VolumeWriteOps  │
│       │       --period 300 --statistics Sum                │
│       │                                                   │
│       ├─> analyzeIopsDemand()                             │
│       │   ├─> Current avg IOPS (last 1h)                  │
│       │   ├─> Trend detection (rising/falling/stable)     │
│       │   └─> Target IOPS calculation                     │
│       │                                                   │
│       └─> [target ≠ current] adjustIops()                 │
│           └─> aws ec2 modify-volume --iops {target}       │
│               --throughput {calculated}                    │
└───────────────────────────────────────────────────────────┘
```

### Integration Points

| Module | File | Usage |
|--------|------|-------|
| K8s Config | `src/lib/k8s-config.ts` | AWS CLI auth, region detection |
| Scheduler | `src/lib/scheduler.ts` | Hourly cron task |
| State Store | `src/lib/redis-store.ts` | Last modification time, IOPS history |

### State Management

Extends `IStateStore`:
- `getEbsOptimizerState(): Promise<EbsOptimizerState | null>`
- `setEbsOptimizerState(state: EbsOptimizerState): Promise<void>`

---

## 3. Detailed Design

### 3.1 New Types

**File: `src/types/ebs-optimizer.ts`** (NEW)

```typescript
/**
 * EBS GP3 Dynamic IOPS Tuning Types
 */

/** EBS volume info */
export interface EbsVolumeInfo {
  volumeId: string;               // e.g., 'vol-0abc123def456'
  volumeType: string;             // 'gp3' | 'gp2' | 'io1' | etc.
  sizeGiB: number;
  currentIops: number;
  currentThroughput: number;      // MB/s
  availabilityZone: string;
  attachedTo: string;             // Instance/Pod ID
  tags: Record<string, string>;
}

/** IOPS metrics from CloudWatch */
export interface IopsMetrics {
  timestamp: string;
  period: number;                 // seconds (300 = 5 min)
  readOps: number;                // Total read operations in period
  writeOps: number;               // Total write operations in period
  totalIops: number;              // (readOps + writeOps) / period
  queueLength: number;            // VolumeQueueLength (average)
}

/** IOPS analysis result */
export interface IopsAnalysis {
  avgIops1h: number;              // Average IOPS over last 1 hour
  peakIops1h: number;             // Peak IOPS over last 1 hour
  avgIops24h: number;             // Average IOPS over last 24 hours
  trend: 'rising' | 'falling' | 'stable';
  currentProvisioned: number;     // Currently provisioned IOPS
  recommendedIops: number;        // Recommended IOPS
  recommendedThroughput: number;  // Recommended throughput (MB/s)
  reason: string;                 // Human-readable reason
}

/** Volume modification result */
export interface VolumeModificationResult {
  success: boolean;
  volumeId: string;
  previousIops: number;
  newIops: number;
  previousThroughput: number;
  newThroughput: number;
  timestamp: string;
  error?: string;
}

/** Optimizer state */
export interface EbsOptimizerState {
  volumeId: string | null;
  lastModificationTime: number | null;   // Unix timestamp
  lastCheckTime: number;                 // Unix timestamp
  modificationHistory: VolumeModificationResult[];  // Ring buffer, max 20
  currentIops: number;
  currentThroughput: number;
}

/** Configuration */
export interface EbsOptimizerConfig {
  enabled: boolean;
  volumeTag: string;                     // Tag to identify the EBS volume (default: see below)
  baselineIops: number;                  // GP3 free tier (default: 3000)
  maxIops: number;                       // Maximum IOPS to provision (default: 10000)
  baselineThroughput: number;            // GP3 free tier MB/s (default: 125)
  scaleUpThresholdPct: number;           // Scale up when avg > this % of current (default: 80)
  scaleDownThresholdPct: number;         // Scale down when avg < this % of current (default: 30)
  cooldownHours: number;                 // AWS limit: 6 hours between modifications
  checkIntervalMinutes: number;          // How often to check (default: 60)
}

export const DEFAULT_EBS_OPTIMIZER_CONFIG: EbsOptimizerConfig = {
  enabled: false,
  volumeTag: 'kubernetes.io/created-for/pvc/name',
  baselineIops: 3000,
  maxIops: 10000,
  baselineThroughput: 125,
  scaleUpThresholdPct: 80,
  scaleDownThresholdPct: 30,
  cooldownHours: 6,
  checkIntervalMinutes: 60,
};

/** IOPS pricing */
export const EBS_PRICING = {
  gp3IopsPerMonth: 0.0065,              // USD per provisioned IOPS above 3,000
  gp3ThroughputPerMonth: 0.04,          // USD per MB/s above 125
  freeBaselineIops: 3000,
  freeBaselineThroughputMBps: 125,
};
```

### 3.2 Core Module

**File: `src/lib/ebs-optimizer.ts`** (NEW, ~300 lines)

```typescript
/**
 * EBS GP3 Dynamic IOPS Tuning
 * Monitors CloudWatch metrics and adjusts provisioned IOPS dynamically.
 */

import { getStore } from '@/lib/redis-store';
import type {
  EbsVolumeInfo,
  IopsMetrics,
  IopsAnalysis,
  VolumeModificationResult,
  EbsOptimizerState,
  EbsOptimizerConfig,
} from '@/types/ebs-optimizer';

// ============================================================
// AWS CLI Helpers
// ============================================================

/**
 * Execute AWS CLI command with proper auth.
 * Uses AWS_PROFILE and AWS_REGION from environment.
 */
async function runAwsCommand(command: string): Promise<string>
```

**Logic for `runAwsCommand()`:**
1. Build command: `aws ${command} --output json`
2. Add `--profile ${AWS_PROFILE}` if set
3. Add `--region ${AWS_REGION || 'ap-northeast-2'}` (default Seoul)
4. Execute via `child_process.execSync()` with 30s timeout
5. Return stdout

```typescript
// ============================================================
// Volume Discovery
// ============================================================

/**
 * Find the EBS volume attached to op-geth PVC.
 *
 * AWS CLI: aws ec2 describe-volumes
 *   --filters "Name=tag:kubernetes.io/created-for/pvc/name,Values=data-{statefulset}-0"
 *   --query "Volumes[0]"
 */
export async function discoverEbsVolume(): Promise<EbsVolumeInfo | null>
```

**Logic for `discoverEbsVolume()`:**
1. PVC name pattern: `data-${K8S_STATEFULSET_PREFIX || 'sepolia-thanos-stack'}-op-geth-0`
2. Or use `EBS_VOLUME_ID` env if explicitly set
3. Call `aws ec2 describe-volumes` with tag filter
4. Parse JSON response → `EbsVolumeInfo`
5. Verify `volumeType === 'gp3'` (skip if not GP3)

```typescript
// ============================================================
// CloudWatch Metrics
// ============================================================

/**
 * Fetch IOPS metrics from CloudWatch for the last N hours.
 *
 * AWS CLI: aws cloudwatch get-metric-statistics
 *   --namespace AWS/EBS
 *   --metric-name VolumeReadOps
 *   --dimensions Name=VolumeId,Value={volumeId}
 *   --start-time {startTime}
 *   --end-time {endTime}
 *   --period 300
 *   --statistics Sum
 */
export async function getIopsMetrics(
  volumeId: string,
  hours: number = 1
): Promise<IopsMetrics[]>
```

**Logic for `getIopsMetrics()`:**
1. Fetch `VolumeReadOps` (Sum, 5-min periods)
2. Fetch `VolumeWriteOps` (Sum, 5-min periods)
3. Optionally fetch `VolumeQueueLength` (Average, 5-min periods)
4. Merge by timestamp
5. Calculate `totalIops = (readOps + writeOps) / periodSeconds`
6. Return sorted by timestamp

```typescript
// ============================================================
// Analysis
// ============================================================

/**
 * Analyze IOPS demand and recommend target IOPS.
 */
export function analyzeIopsDemand(
  metrics1h: IopsMetrics[],
  metrics24h: IopsMetrics[],
  currentIops: number,
  config: EbsOptimizerConfig
): IopsAnalysis
```

**Logic for `analyzeIopsDemand()`:**
1. Calculate `avgIops1h`, `peakIops1h` from 1h metrics
2. Calculate `avgIops24h` from 24h metrics
3. Determine trend:
   - Compare first half avg vs second half avg of 1h window
   - Rising if second > first × 1.2
   - Falling if second < first × 0.8
   - Stable otherwise
4. Calculate recommended IOPS:
   - If `avgIops1h > currentIops × scaleUpThresholdPct / 100` → scale up to `peakIops1h × 1.3` (30% headroom)
   - If `avgIops1h < currentIops × scaleDownThresholdPct / 100` AND stable/falling → scale down to `max(avgIops24h × 1.5, baselineIops)`
   - Otherwise → maintain current
5. Clamp to `[baselineIops, maxIops]`
6. Calculate throughput: `baseline` if IOPS ≤ 3000, else `min(IOPS / 4, 1000)` (rough heuristic)

```typescript
// ============================================================
// Volume Modification
// ============================================================

/**
 * Modify EBS volume IOPS and throughput.
 *
 * AWS CLI: aws ec2 modify-volume
 *   --volume-id {volumeId}
 *   --iops {iops}
 *   --throughput {throughput}
 */
export async function modifyVolumeIops(
  volumeId: string,
  targetIops: number,
  targetThroughput: number
): Promise<VolumeModificationResult>
```

**Logic for `modifyVolumeIops()`:**
1. Check cooldown: if `lastModificationTime + cooldownHours * 3600000 > now` → skip
2. Call `aws ec2 modify-volume --volume-id ${volumeId} --iops ${targetIops} --throughput ${targetThroughput}`
3. Parse response
4. Record in modification history
5. Return result

```typescript
// ============================================================
// Main Optimization Loop
// ============================================================

/**
 * Run one optimization cycle.
 * Called from scheduler every 60 minutes.
 */
export async function optimizeEbsIops(): Promise<VolumeModificationResult | null>
```

**Logic for `optimizeEbsIops()`:**
1. Check `EBS_IOPS_TUNING_ENABLED` env
2. Load state from store
3. Discover volume (cache volumeId in state)
4. Verify GP3 type
5. Fetch 1h and 24h metrics from CloudWatch
6. Analyze demand
7. If `recommendedIops !== currentIops`:
   - Check cooldown
   - Modify volume
   - Save state
8. Return result

```typescript
/**
 * Get optimizer status for API.
 */
export async function getEbsOptimizerStatus(): Promise<{
  enabled: boolean;
  volumeId: string | null;
  currentIops: number | null;
  lastAnalysis: IopsAnalysis | null;
  lastModification: VolumeModificationResult | null;
  modificationHistory: VolumeModificationResult[];
}>
```

### 3.3 Scheduler Integration

**File: `src/lib/scheduler.ts`** (MODIFY)

```typescript
// === IMPORT — add: ===
import { optimizeEbsIops } from '@/lib/ebs-optimizer';

// === MODULE STATE — add: ===
let ebsOptTask: ScheduledTask | null = null;
let ebsOptTaskRunning = false;

// === INSIDE initializeScheduler() — add: ===

// EBS IOPS Optimization — every hour at :30
ebsOptTask = cron.schedule('30 * * * *', async () => {
  if (ebsOptTaskRunning) return;
  ebsOptTaskRunning = true;
  try {
    const result = await optimizeEbsIops();
    if (result?.success) {
      console.log(`[Scheduler] EBS IOPS adjusted: ${result.previousIops} → ${result.newIops}`);
    }
  } catch (error) {
    console.error('[Scheduler] EBS IOPS optimization failed:', error instanceof Error ? error.message : error);
  } finally {
    ebsOptTaskRunning = false;
  }
}, { timezone: 'Asia/Seoul' });

// === INSIDE stopScheduler() — add: ===
ebsOptTask?.stop();
ebsOptTask = null;
```

### 3.4 API Endpoint

**File: `src/app/api/ebs-optimizer/route.ts`** (NEW)

```typescript
import { NextResponse } from 'next/server';
import { getEbsOptimizerStatus, optimizeEbsIops } from '@/lib/ebs-optimizer';

export async function GET() {
  const status = await getEbsOptimizerStatus();
  return NextResponse.json(status);
}

export async function POST() {
  const result = await optimizeEbsIops();
  return NextResponse.json({ result });
}
```

### 3.5 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `EBS_IOPS_TUNING_ENABLED` | `false` | Enable dynamic IOPS tuning |
| `EBS_VOLUME_ID` | auto-detect | Explicit EBS volume ID (skip auto-detection) |
| `EBS_MAX_IOPS` | `10000` | Maximum IOPS to provision |

Add to `.env.local.sample`:
```bash
# === EBS IOPS Tuning (Optional) ===
# EBS_IOPS_TUNING_ENABLED=true    # Dynamic GP3 IOPS based on CloudWatch metrics
# EBS_VOLUME_ID=vol-0abc123       # Explicit volume ID (auto-detected if omitted)
# EBS_MAX_IOPS=10000              # Maximum IOPS to provision
```

---

## 4. Implementation Guide

### File Changes

| # | File | Action | Changes |
|---|------|--------|---------|
| 1 | `src/types/ebs-optimizer.ts` | CREATE | Type definitions (~90 lines) |
| 2 | `src/lib/ebs-optimizer.ts` | CREATE | Core module (~300 lines) |
| 3 | `src/lib/scheduler.ts` | MODIFY | Hourly cron task (+18 lines) |
| 4 | `src/types/redis.ts` | MODIFY | IStateStore extension (+2 lines) |
| 5 | `src/lib/state-store.ts` | MODIFY | InMemoryStateStore (+10 lines) |
| 6 | `src/lib/redis-state-store.ts` | MODIFY | RedisStateStore (+15 lines) |
| 7 | `src/app/api/ebs-optimizer/route.ts` | CREATE | API endpoint (~15 lines) |
| 8 | `src/lib/__tests__/ebs-optimizer.test.ts` | CREATE | Tests (~220 lines) |
| 9 | `.env.local.sample` | MODIFY | Add env vars (+4 lines) |
| 10 | `CLAUDE.md` | MODIFY | Add env vars + API route (+4 lines) |

### Reusable Functions

```typescript
// AWS CLI execution — new helper, but uses same auth pattern as k8s-config.ts:
// - AWS_PROFILE env var
// - AWS_REGION / AWS_DEFAULT_REGION env var
// - child_process.execSync for CLI calls

// From redis-store.ts
import { getStore } from '@/lib/redis-store';
```

### IStateStore Extension

```typescript
// Add to IStateStore interface:
getEbsOptimizerState(): Promise<EbsOptimizerState | null>;
setEbsOptimizerState(state: EbsOptimizerState): Promise<void>;
```

### Implementation Order

1. Types → 2. IStateStore → 3. Store implementations → 4. Core module → 5. Scheduler → 6. API → 7. Tests → 8. Config

---

## 5. Test Specification

**File: `src/lib/__tests__/ebs-optimizer.test.ts`** (NEW)

### Mock Strategy

```typescript
import { execSync } from 'child_process';
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn().mockReturnValue({
    getEbsOptimizerState: vi.fn().mockResolvedValue(null),
    setEbsOptimizerState: vi.fn().mockResolvedValue(undefined),
  }),
}));
```

### Test Cases

```
describe('ebs-optimizer')
  describe('discoverEbsVolume')
    it('should find volume by PVC tag')
    it('should use EBS_VOLUME_ID when explicitly set')
    it('should return null for non-GP3 volumes')
    it('should return null when no volume found')

  describe('getIopsMetrics')
    it('should parse CloudWatch response correctly')
    it('should calculate totalIops from read+write ops')
    it('should handle empty CloudWatch response')

  describe('analyzeIopsDemand')
    it('should recommend scale up when avg > 80% of current')
    it('should recommend scale down when avg < 30% of current and stable')
    it('should NOT scale down when trend is rising')
    it('should clamp to baseline IOPS (3000) minimum')
    it('should clamp to maxIops (10000) maximum')
    it('should detect rising trend correctly')
    it('should detect falling trend correctly')
    it('should calculate appropriate throughput')

  describe('modifyVolumeIops')
    it('should call aws ec2 modify-volume with correct params')
    it('should skip when in cooldown (< 6 hours)')
    it('should handle AWS error gracefully')
    it('should record modification in history')

  describe('optimizeEbsIops')
    it('should skip when disabled')
    it('should run full cycle: discover → metrics → analyze → modify')
    it('should skip modification when no change needed')
    it('should cache volumeId in state')
```

### Minimum Coverage Target

- Statement coverage: ≥ 80%
- Branch coverage: ≥ 75%

---

## 6. Verification

### Step 1: Build

```bash
npm run build
```

### Step 2: Unit Tests

```bash
npx vitest run src/lib/__tests__/ebs-optimizer.test.ts
```

### Step 3: Integration Test (requires AWS credentials)

```bash
# Check volume detection
EBS_IOPS_TUNING_ENABLED=true npm run dev
curl http://localhost:3002/api/ebs-optimizer | jq .

# Verify CloudWatch metrics are being fetched
# (check server logs for "[EBS Optimizer]" messages)
```

### Step 4: Full Test Suite

```bash
npm run test:run
```
