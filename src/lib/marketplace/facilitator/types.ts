import type { Address } from 'viem';

export type FacilitatorProfileId = 'mainnet' | 'sepolia';
export type FacilitatorNetwork = 'eip155:1' | 'eip155:11155111';

export interface MerchantAllowlistEntry {
  merchantId: string;
  address: Address;
  resources: string[];
  networks: FacilitatorNetwork[];
}

export interface FacilitatorProfile {
  id: FacilitatorProfileId;
  enabled: boolean;
  chainId: 1 | 11155111;
  network: FacilitatorNetwork;
  rpcUrl: string;
  relayerPrivateKey: `0x${string}`;
  facilitatorAddress: Address;
  tonAssetAddress: Address;
}

export interface FacilitatorReconcilerConfig {
  enabled: boolean;
  cron: string;
}

export interface FacilitatorConfig {
  redisPrefix: string;
  internalAuthSecret: string;
  receiptSigningKey: `0x${string}`;
  merchantAllowlist: MerchantAllowlistEntry[];
  reconciler: FacilitatorReconcilerConfig;
  profiles: Record<FacilitatorProfileId, FacilitatorProfile>;
}

export interface PaymentAuthorization {
  buyer: Address;
  merchant: Address;
  asset: Address;
  amount: bigint;
  resource: string;
  nonce: `0x${string}`;
  validAfter: bigint;
  validBefore: bigint;
}

export interface PaymentAuthorizationExpectation {
  merchant: Address;
  asset: Address;
  amount: bigint;
  resource: string;
}

export interface PaymentAuthorizationVerificationInput {
  profile: Pick<FacilitatorProfile, 'chainId' | 'network' | 'facilitatorAddress' | 'tonAssetAddress'>;
  network: FacilitatorNetwork;
  authorization: PaymentAuthorization;
  signature: `0x${string}`;
  expected: PaymentAuthorizationExpectation;
  now: bigint;
}

export interface PaymentAuthorizationVerificationResult {
  isValid: boolean;
  signer?: Address;
  reason?: string;
}

export type SettlementStatus = 'submitted' | 'settled' | 'failed';

export interface SettlementRecord {
  settlementId: string;
  chainId: number;
  network: FacilitatorNetwork;
  merchantId: string;
  asset: Address;
  buyer: Address;
  merchant: Address;
  amount: string;
  resource: string;
  nonce: `0x${string}`;
  txHash: `0x${string}`;
  status: SettlementStatus;
  txStatus: SettlementStatus;
  receiptSignature: `0x${string}`;
  confirmedBlock: number | null;
  transferVerified: boolean;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementStatusUpdate {
  status: SettlementStatus;
  txStatus: SettlementStatus;
  transferVerified: boolean;
  confirmedBlock: number | null;
  failureReason: string | null;
}

export interface CheckFundsInput {
  profile: Pick<FacilitatorProfile, 'chainId' | 'rpcUrl' | 'tonAssetAddress'>;
  buyer: Address;
  facilitatorSpender: Address;
  amount: bigint;
}

export interface CheckFundsResult {
  balance: bigint;
  allowance: bigint;
}

export interface SettleTransferInput {
  profile: Pick<FacilitatorProfile, 'chainId' | 'rpcUrl' | 'relayerPrivateKey' | 'tonAssetAddress' | 'facilitatorAddress'>;
  buyer: Address;
  merchant: Address;
  expectedMerchant: Address;
  amount: bigint;
  resource: string;
  nonce: `0x${string}`;
  validAfter: bigint;
  validBefore: bigint;
  signature: `0x${string}`;
}

export interface SettleTransferResult {
  txHash: `0x${string}`;
  status: 'submitted';
}

export interface VerifySettlementInput {
  profile: Pick<FacilitatorProfile, 'rpcUrl' | 'tonAssetAddress'>;
  txHash: `0x${string}`;
  expected: {
    buyer: Address;
    merchant: Address;
    amount: bigint;
  };
}

export interface VerifySettlementResult {
  status: SettlementStatus;
  blockNumber: number | null;
  transferVerified: boolean;
  failureReason?: string;
}

export interface SettlementReceiptPayload {
  success: boolean;
  settlementId: string;
  chainId: number;
  asset: Address;
  amount: string;
  buyer: Address;
  merchant: Address;
  resource: string;
  txHash: `0x${string}`;
  blockNumber: number | null;
  status: SettlementStatus;
}

export interface SignedSettlementReceipt {
  payload: SettlementReceiptPayload;
  signature: `0x${string}`;
  signer: Address;
}

export interface SettlementReceiptVerificationResult {
  isValid: boolean;
  signer?: Address;
  reason?: string;
}
