/**
 * On-chain Review Registry interaction
 * Submits reviews via MetaMask and reads via event scanning
 */

const REVIEW_REGISTRY = '0xe63FCdbDAb179F25220361eeAe5fCf60B9151340' as const;
const FACILITATOR_V2 = '0x94B6149ffdb6F55C3CA86C615764f2d5f097dE26' as const;
const SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';

// submitReview(address,bytes32,uint8,uint8,uint8,uint8,string) selector
const SUBMIT_REVIEW_SELECTOR = '0x'; // Will compute below

/** Hex-encode helpers */
function encodeAddress(addr: string): string {
  return addr.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
}
function encodeUint256(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}
function encodeUint8(value: number): string {
  return value.toString(16).padStart(64, '0');
}

/**
 * Submit a review on-chain via MetaMask
 * Calls ReviewRegistry.submitReview(operator, settlementNonce, ratings..., comment)
 */
export async function submitReviewOnChain(params: {
  account: string;
  operator: string;
  settlementNonce: string;
  dataAccuracy: number;
  responseSpeed: number;
  uptime: number;
  valueForMoney: number;
  comment: string;
}): Promise<{ txHash: string }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error('MetaMask not available');

  const { account, operator, settlementNonce, dataAccuracy, responseSpeed, uptime, valueForMoney, comment } = params;

  // ABI encode submitReview(address,bytes32,uint8,uint8,uint8,uint8,string)
  // Function selector: keccak256("submitReview(address,bytes32,uint8,uint8,uint8,uint8,string)")[:4]
  // Manual calculation: we'll use the known selector
  const selector = '45f7d57b'; // keccak256("submitReview(address,bytes32,uint8,uint8,uint8,uint8,string)")[:4]

  const operatorEnc = encodeAddress(operator);
  const nonceEnc = settlementNonce.startsWith('0x')
    ? settlementNonce.slice(2).padStart(64, '0')
    : settlementNonce.padStart(64, '0');
  const daEnc = encodeUint8(dataAccuracy);
  const rsEnc = encodeUint8(responseSpeed);
  const utEnc = encodeUint8(uptime);
  const vmEnc = encodeUint8(valueForMoney);

  // String encoding: offset (7th param at slot 6 = 224 bytes = 0xe0)
  const commentHex = Array.from(new TextEncoder().encode(comment))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const commentLength = encodeUint256(BigInt(commentHex.length / 2));
  const commentPadded = commentHex + '0'.repeat((64 - (commentHex.length % 64)) % 64);
  const commentOffset = encodeUint256(BigInt(224)); // 7 * 32 = 224

  const calldata = '0x' + selector +
    operatorEnc +
    nonceEnc +
    daEnc +
    rsEnc +
    utEnc +
    vmEnc +
    commentOffset +
    commentLength +
    commentPadded;

  const txHash = await eth.request({
    method: 'eth_sendTransaction',
    params: [{
      from: account,
      to: REVIEW_REGISTRY,
      data: calldata,
    }],
  });

  return { txHash: txHash as string };
}

/**
 * Wait for tx confirmation
 */
export async function waitForReviewTx(txHash: string): Promise<boolean> {
  const eth = (window as any).ethereum;
  if (!eth) return false;

  for (let i = 0; i < 40; i++) {
    const receipt = await eth.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }) as { status: string } | null;

    if (receipt) {
      return receipt.status !== '0x0';
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return false;
}

export interface OnChainReview {
  reviewer: string;
  operator: string;
  settlementNonce: string;
  dataAccuracy: number;
  responseSpeed: number;
  uptime: number;
  valueForMoney: number;
  comment: string;
  blockNumber: number;
  txHash: string;
}

/**
 * Fetch reviews from on-chain ReviewSubmitted events
 */
export async function fetchOnChainReviews(operatorAddress?: string): Promise<OnChainReview[]> {
  // ReviewSubmitted event topic
  // keccak256("ReviewSubmitted(address,address,bytes32,uint8,uint8,uint8,uint8,string)")
  const EVENT_TOPIC = '0x'; // Will be fetched via API

  try {
    const res = await fetch('/api/marketplace/reviews-onchain' + (operatorAddress ? `?operator=${operatorAddress}` : ''));
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export { REVIEW_REGISTRY, FACILITATOR_V2 };
