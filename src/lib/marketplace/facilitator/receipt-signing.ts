import { getAddress, hexToBytes, keccak256, recoverMessageAddress, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type {
  SettlementReceiptPayload,
  SettlementReceiptVerificationResult,
  SignedSettlementReceipt,
} from '@/lib/marketplace/facilitator/types';

function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right)
    );
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalizeJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashReceiptPayload(payload: SettlementReceiptPayload): `0x${string}` {
  return keccak256(stringToHex(canonicalizeJson(payload)));
}

function packReceiptSignature(signer: `0x${string}`, signature: `0x${string}`): `0x${string}` {
  return `0x${signer.slice(2)}${signature.slice(2)}` as `0x${string}`;
}

function unpackReceiptSignature(signature: `0x${string}`): {
  signer: `0x${string}`;
  rawSignature: `0x${string}`;
} {
  if (signature.length <= 42) {
    throw new Error('Receipt signature payload is too short');
  }

  return {
    signer: `0x${signature.slice(2, 42)}` as `0x${string}`,
    rawSignature: `0x${signature.slice(42)}` as `0x${string}`,
  };
}

export async function signSettlementReceipt(
  payload: SettlementReceiptPayload,
  signingKey: `0x${string}`
): Promise<SignedSettlementReceipt> {
  const account = privateKeyToAccount(signingKey);
  const digest = hashReceiptPayload(payload);
  const rawSignature = await account.signMessage({ message: { raw: hexToBytes(digest) } });
  const signer = getAddress(account.address);

  return {
    payload,
    signature: packReceiptSignature(signer, rawSignature),
    signer,
  };
}

export async function verifySettlementReceipt(
  payload: SettlementReceiptPayload,
  signature: `0x${string}`
): Promise<SettlementReceiptVerificationResult> {
  try {
    const digest = hashReceiptPayload(payload);
    const packed = unpackReceiptSignature(signature);
    const signer = await recoverMessageAddress({
      message: { raw: hexToBytes(digest) },
      signature: packed.rawSignature,
    });
    if (getAddress(signer) !== getAddress(packed.signer)) {
      return {
        isValid: false,
        reason: 'Receipt signature does not match the packed signer',
      };
    }

    return {
      isValid: true,
      signer: getAddress(signer),
    };
  } catch (error) {
    return {
      isValid: false,
      reason: error instanceof Error ? error.message : 'Invalid receipt signature',
    };
  }
}

export { canonicalizeJson as canonicalizeReceiptPayload };
