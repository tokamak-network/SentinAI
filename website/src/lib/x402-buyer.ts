/**
 * x402 Buyer — client-side utility for TON payment authorization via MetaMask.
 *
 * Encodes ERC-20 calls manually (no ethers/viem) to keep the website bundle lean.
 */

export interface PaymentRequirements {
  network: string;
  asset: string;
  amount: string;
  resource: string;
  merchant: string;
  facilitator: {
    address?: string;
    spender: string;
    settleUrl?: string;
    receiptUrl?: string;
  };
  authorization: {
    type: string;
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    primaryType: string;
    types: Record<string, { name: string; type: string }[]>;
  };
}

export interface WalletInfo {
  account: string;
  chainId: number;
}

export interface TokenInfo {
  balance: bigint;
  allowance: bigint;
}

export interface SettlementResult {
  success: boolean;
  settlementId?: string;
  txHash?: string;
  settlementStatus?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;  // allow extra data fields from API response
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

function requireEthereum(): NonNullable<Window['ethereum']> {
  if (!window.ethereum) {
    throw new Error('MetaMask (or compatible wallet) is not installed');
  }
  return window.ethereum;
}

/** Encodes a uint256 as a 32-byte hex string (no 0x prefix) */
function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}

/** Encodes an address as a 32-byte hex string (no 0x prefix, zero-padded) */
function encodeAddress(addr: string): string {
  return addr.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}

/** Builds a bytes32 nonce from 32 random bytes */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Connects MetaMask and ensures the user is on the correct chain.
 */
export async function connectWallet(targetChainId = 11155111): Promise<WalletInfo> {
  const eth = requireEthereum();

  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[];
  if (!accounts.length) throw new Error('No accounts returned from wallet');
  const account = accounts[0];

  const chainHex = (await eth.request({ method: 'eth_chainId' })) as string;
  const currentChainId = parseInt(chainHex, 16);

  if (currentChainId !== targetChainId) {
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      });
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      if (code === 4902) {
        throw new Error(`Chain ${targetChainId} (Sepolia) not added to your wallet. Please add it manually.`);
      }
      throw err;
    }
  }

  return { account, chainId: targetChainId };
}

/**
 * Returns TON balance and allowance for the given account and spender.
 */
export async function getTokenInfo(params: {
  account: string;
  tokenAddress: string;
  spenderAddress: string;
}): Promise<TokenInfo> {
  const eth = requireEthereum();
  const { account, tokenAddress, spenderAddress } = params;

  // balanceOf(address) → selector 0x70a08231
  const balanceData = '0x70a08231' + encodeAddress(account);
  const balanceHex = (await eth.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data: balanceData }, 'latest'],
  })) as string;

  // allowance(address,address) → selector 0xdd62ed3e
  const allowanceData = '0xdd62ed3e' + encodeAddress(account) + encodeAddress(spenderAddress);
  const allowanceHex = (await eth.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data: allowanceData }, 'latest'],
  })) as string;

  // Safe BigInt conversion: ensure valid hex format
  const safeHexToBigInt = (hex: string): bigint => {
    if (!hex || hex === '0x' || hex === '') return BigInt(0);
    try {
      return BigInt(hex);
    } catch {
      return BigInt(0);
    }
  };

  return {
    balance: safeHexToBigInt(balanceHex),
    allowance: safeHexToBigInt(allowanceHex),
  };
}

/**
 * Sends an ERC-20 approve transaction.
 * Returns the transaction hash.
 */
export async function approveToken(params: {
  account: string;
  tokenAddress: string;
  spenderAddress: string;
  amount: bigint;
}): Promise<string> {
  const eth = requireEthereum();
  const { account, tokenAddress, spenderAddress, amount } = params;

  // approve(address,uint256) → selector 0x095ea7b3
  const data = '0x095ea7b3' + encodeAddress(spenderAddress) + encodeUint256(amount);

  const txHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from: account, to: tokenAddress, data }],
  })) as string;

  return txHash;
}

/**
 * Calls TON.approveAndCall(facilitator, amount, settleData) in a single tx.
 * This atomically: approves → calls Facilitator.onApprove → two-hop transfer.
 * Returns the transaction hash.
 */
export async function approveAndCallSettle(params: {
  account: string;
  tokenAddress: string;
  facilitatorAddress: string;
  amount: bigint;
  settleData: string; // hex-encoded ABI data for onApprove
}): Promise<string> {
  const eth = requireEthereum();
  const { account, tokenAddress, facilitatorAddress, amount, settleData } = params;

  // approveAndCall(address spender, uint256 amount, bytes data) → selector 0xcae9ca51
  // ABI encode: address(32) + uint256(32) + offset(32) + length(32) + data
  const spenderEncoded = encodeAddress(facilitatorAddress);
  const amountEncoded = encodeUint256(amount);

  // Strip 0x from settleData
  const dataHex = settleData.startsWith('0x') ? settleData.slice(2) : settleData;
  const dataLengthBytes = dataHex.length / 2;

  // Dynamic bytes encoding: offset = 96 (3 × 32), then length + padded data
  const offset = encodeUint256(BigInt(96)); // offset to bytes data
  const dataLength = encodeUint256(BigInt(dataLengthBytes));
  const paddedData = dataHex + '0'.repeat((64 - (dataHex.length % 64)) % 64);

  const calldata = '0xcae9ca51' + spenderEncoded + amountEncoded + offset + dataLength + paddedData;

  const txHash = (await eth.request({
    method: 'eth_sendTransaction',
    params: [{ from: account, to: tokenAddress, data: calldata }],
  })) as string;

  return txHash;
}

/**
 * ABI-encodes settlement parameters for FacilitatorV2.onApprove.
 * encode(merchant, resource, nonce, validAfter, validBefore, signature)
 */
export function encodeSettleData(params: {
  merchant: string;
  resource: string;
  nonce: string;
  validAfter: string;
  validBefore: string;
  signature: string;
}): string {
  const { merchant, resource, nonce, validAfter, validBefore, signature } = params;

  // Manual ABI encoding for (address, string, bytes32, uint256, uint256, bytes)
  // This is complex — use a simplified approach with hex concatenation

  const merchantEnc = encodeAddress(merchant);
  const nonceEnc = nonce.startsWith('0x') ? nonce.slice(2).padStart(64, '0') : nonce.padStart(64, '0');
  const validAfterEnc = encodeUint256(BigInt(validAfter));
  const validBeforeEnc = encodeUint256(BigInt(validBefore));

  // Dynamic types need offset pointers
  // Layout: merchant(0) + resourceOffset(1) + nonce(2) + validAfter(3) + validBefore(4) + signatureOffset(5) + resourceData + signatureData

  // Resource string encoding
  const resourceHex = Array.from(new TextEncoder().encode(resource))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const resourceLength = encodeUint256(BigInt(resourceHex.length / 2));
  const resourcePadded = resourceHex + '0'.repeat((64 - (resourceHex.length % 64)) % 64);

  // Signature bytes encoding
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
  const sigLength = encodeUint256(BigInt(sigHex.length / 2));
  const sigPadded = sigHex + '0'.repeat((64 - (sigHex.length % 64)) % 64);

  // Offsets (each slot = 32 bytes = 64 hex chars)
  // 6 head slots × 32 = 192 bytes → resource starts at 192
  const resourceOffset = encodeUint256(BigInt(192));
  // signature starts at 192 + 32(length) + padded resource data
  const resourceTotalHex = resourceLength + resourcePadded;
  const sigOffset = encodeUint256(BigInt(192 + resourceTotalHex.length / 2));

  return '0x' +
    merchantEnc +       // slot 0: address merchant
    resourceOffset +    // slot 1: offset to string resource
    nonceEnc +          // slot 2: bytes32 nonce
    validAfterEnc +     // slot 3: uint256 validAfter
    validBeforeEnc +    // slot 4: uint256 validBefore
    sigOffset +         // slot 5: offset to bytes signature
    resourceLength + resourcePadded +  // string resource (length + data)
    sigLength + sigPadded;             // bytes signature (length + data)
}

/**
 * Waits for a transaction to be mined (polls receipt every 3s, up to 2 minutes).
 */
export async function waitForTx(txHash: string): Promise<void> {
  const eth = requireEthereum();
  const maxAttempts = 40;
  for (let i = 0; i < maxAttempts; i++) {
    const receipt = (await eth.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    })) as { status: string } | null;
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('Transaction reverted');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new Error('Transaction confirmation timeout');
}

/**
 * Signs an EIP-712 PaymentAuthorization and returns a base64-encoded X-PAYMENT header.
 */
export async function signPaymentAuthorization(params: {
  account: string;
  paymentRequirements: PaymentRequirements;
}): Promise<string> {
  const eth = requireEthereum();
  const { account, paymentRequirements } = params;

  const now = Math.floor(Date.now() / 1000);
  const nonce = randomNonce();

  // Match SentinAIFacilitator.sol PaymentAuthorization struct exactly
  const authorization = {
    buyer: account,
    merchant: paymentRequirements.merchant,
    asset: paymentRequirements.asset,
    amount: paymentRequirements.amount,
    resource: paymentRequirements.resource,
    nonce: nonce,
    validAfter: String(now - 60),     // valid from 1 min ago
    validBefore: String(now + 300),   // valid for 5 min
  };

  const typedData = {
    domain: paymentRequirements.authorization.domain,
    types: paymentRequirements.authorization.types,
    primaryType: paymentRequirements.authorization.primaryType,
    message: authorization,
  };

  const signature = (await eth.request({
    method: 'eth_signTypedData_v4',
    params: [account, JSON.stringify(typedData)],
  })) as string;

  const header = {
    x402Version: 2,
    scheme: 'exact',
    network: paymentRequirements.network,
    payload: {
      ...authorization,
      signature,
    },
  };

  return btoa(JSON.stringify(header));
}

/**
 * Executes the x402 payment: fetches the endpoint with X-PAYMENT header.
 * Returns the settlement result from the response body.
 */
export async function executePayment(params: {
  endpoint: string;
  paymentHeader: string;
}): Promise<SettlementResult> {
  const res = await fetch(params.endpoint, {
    method: 'GET',
    headers: {
      'X-PAYMENT': params.paymentHeader,
      Accept: 'application/json',
    },
  });

  if (res.ok) {
    const body = await res.json().catch(() => ({}));
    const settlementStatus = res.headers.get('X-Settlement-Status') ?? 'unknown';
    const settlementTxHash = res.headers.get('X-Settlement-TxHash') ?? undefined;
    return {
      success: true,
      settlementStatus,
      txHash: settlementTxHash,
      ...body,
    };
  }

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    return { success: false, error: `Payment required: ${JSON.stringify(body)}` };
  }

  const body = await res.json().catch(() => ({}));
  return { success: false, error: body.error ?? `HTTP ${res.status}` };
}
