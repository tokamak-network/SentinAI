import { getAddress } from 'viem';
import { getCoreRedis } from '@/core/redis';

interface ConsumeNonceInput {
  redisPrefix: string;
  chainId: number;
  buyer: `0x${string}`;
  nonce: `0x${string}`;
  validBefore: bigint;
}

function getRedisClient() {
  const redis = getCoreRedis();
  if (!redis) {
    throw new Error('Redis is required for facilitator nonce storage');
  }
  return redis;
}

function getNonceKey(input: ConsumeNonceInput): string {
  return `${input.redisPrefix}:facilitator:nonce:${input.chainId}:${getAddress(input.buyer)}:${input.nonce}`;
}

export async function consumeNonce(input: ConsumeNonceInput): Promise<void> {
  const redis = getRedisClient();
  const result = await redis.set(
    getNonceKey(input),
    new Date().toISOString(),
    'EXAT',
    Number(input.validBefore),
    'NX'
  );

  if (result !== 'OK') {
    throw new Error('Payment authorization nonce has already been used');
  }
}
