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
    spender: string;
    settleUrl: string;
    receiptUrl: string;
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
  status?: string;
  error?: string;
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
    return { success: true, ...body };
  }

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    return { success: false, error: `Payment required: ${JSON.stringify(body)}` };
  }

  const body = await res.json().catch(() => ({}));
  return { success: false, error: body.error ?? `HTTP ${res.status}` };
}
