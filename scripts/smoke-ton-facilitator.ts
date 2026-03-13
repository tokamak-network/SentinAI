#!/usr/bin/env tsx

import { loadEnvConfig } from '@next/env';
import { createPublicClient, erc20Abi, formatUnits, getAddress, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { loadFacilitatorConfig } from '../src/lib/marketplace/facilitator/config';
import { verifySettlementReceipt } from '../src/lib/marketplace/facilitator/receipt-signing';
import { getPaymentAuthorizationDomain, getPaymentAuthorizationTypes } from '../src/lib/marketplace/facilitator/typed-data';
import {
  buildSmokePaymentHeader,
  createSmokeAuthorization,
  loadFacilitatorSmokeConfig,
} from '../src/lib/marketplace/facilitator-smoke';
import type { SettlementReceiptPayload, SettlementRecord } from '../src/lib/marketplace/facilitator/types';

interface SettleResponse extends SettlementReceiptPayload {
  signature: `0x${string}`;
  signer: `0x${string}`;
}

let currentStep = 0;

function step(message: string) {
  currentStep += 1;
  console.log(`[${currentStep}/6] ${message}`);
}

function info(message: string) {
  console.log(`INFO: ${message}`);
}

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

async function main() {
  loadEnvConfig(process.cwd());

  const smoke = loadFacilitatorSmokeConfig(process.env);
  const facilitator = loadFacilitatorConfig();
  const profile = facilitator.profiles.sepolia;

  if (!profile.enabled) {
    fail('TON_FACILITATOR_SEPOLIA_ENABLED must be true for the smoke test');
  }

  const allowlistedMerchant = facilitator.merchantAllowlist.find((entry) => entry.merchantId === smoke.merchantId);
  if (!allowlistedMerchant) {
    fail(`Merchant '${smoke.merchantId}' is not present in TON_FACILITATOR_MERCHANT_ALLOWLIST`);
  }
  if (getAddress(allowlistedMerchant.address) !== getAddress(smoke.merchantAddress)) {
    fail('TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS does not match the merchant allowlist entry');
  }
  if (!allowlistedMerchant.networks.includes('eip155:11155111')) {
    fail(`Merchant '${smoke.merchantId}' is not enabled for eip155:11155111 in TON_FACILITATOR_MERCHANT_ALLOWLIST`);
  }
  if (!allowlistedMerchant.resources.includes(smoke.resource)) {
    fail(`Resource '${smoke.resource}' is not allowlisted for merchant '${smoke.merchantId}'`);
  }

  const buyer = privateKeyToAccount(smoke.buyerPrivateKey);
  const client = createPublicClient({
    transport: http(profile.rpcUrl, { timeout: 15_000 }),
  });

  step('Loaded config');
  info(`Base URL: ${smoke.baseUrl}`);
  info(`Buyer: ${buyer.address}`);
  info(`Facilitator spender: ${profile.facilitatorAddress}`);

  const [balance, allowance] = await Promise.all([
    client.readContract({
      address: profile.tonAssetAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [buyer.address],
    }),
    client.readContract({
      address: profile.tonAssetAddress,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [buyer.address, profile.facilitatorAddress],
    }),
  ]);

  if (balance < smoke.amount) {
    fail(
      `allowance-check: buyer balance ${balance} is below required ${smoke.amount} (${formatUnits(balance, 18)} TON available)`
    );
  }
  if (allowance < smoke.amount) {
    fail(
      `allowance-check: allowance ${allowance} is below required ${smoke.amount} (${formatUnits(allowance, 18)} TON approved)`
    );
  }

  step('Buyer balance OK, allowance OK');

  const authorization = createSmokeAuthorization({
    buyer: buyer.address,
    merchant: smoke.merchantAddress,
    asset: profile.tonAssetAddress,
    amount: smoke.amount,
    resource: smoke.resource,
  });
  const signature = await buyer.signTypedData({
    domain: getPaymentAuthorizationDomain(profile),
    types: getPaymentAuthorizationTypes(),
    primaryType: 'PaymentAuthorization',
    message: authorization,
  });
  const paymentHeader = buildSmokePaymentHeader({
    network: profile.network,
    authorization,
    signature,
  });

  step('Signed PaymentAuthorization');
  info(`X-PAYMENT: ${paymentHeader}`);

  const settleResponse = await fetch(`${smoke.baseUrl}/api/facilitator/v1/settle`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sentinai-internal-auth': smoke.internalAuthSecret,
      'x-sentinai-merchant-id': smoke.merchantId,
    },
    body: JSON.stringify({
      network: profile.network,
      authorization: {
        buyer: authorization.buyer,
        merchant: authorization.merchant,
        asset: authorization.asset,
        amount: authorization.amount.toString(),
        resource: authorization.resource,
        nonce: authorization.nonce,
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
      },
      signature,
    }),
  });

  const settleBody = (await settleResponse.json()) as SettleResponse | { error?: string };
  if (!settleResponse.ok) {
    fail(`settle-route: ${(settleBody as { error?: string }).error ?? `HTTP ${settleResponse.status}`}`);
  }

  const receipt = settleBody as SettleResponse;
  const receiptVerification = await verifySettlementReceipt(
    {
      success: receipt.success,
      settlementId: receipt.settlementId,
      chainId: receipt.chainId,
      asset: receipt.asset,
      amount: receipt.amount,
      buyer: receipt.buyer,
      merchant: receipt.merchant,
      resource: receipt.resource,
      txHash: receipt.txHash,
      blockNumber: receipt.blockNumber,
      status: receipt.status,
    },
    receipt.signature
  );
  if (!receiptVerification.isValid) {
    fail(`receipt-verification: ${receiptVerification.reason ?? 'invalid signature'}`);
  }

  step(`Facilitator settle accepted: settlementId=${receipt.settlementId}`);
  info(`txHash=${receipt.txHash} signer=${receipt.signer}`);

  const readSettlement = async (): Promise<SettlementRecord> => {
    const response = await fetch(
      `${smoke.baseUrl}/api/facilitator/v1/settlements/${receipt.settlementId}?chainId=${profile.chainId}`,
      {
        headers: {
          'x-sentinai-internal-auth': smoke.internalAuthSecret,
        },
      }
    );
    const body = (await response.json()) as SettlementRecord | { error?: string };
    if (!response.ok) {
      fail(`settlement-read: ${(body as { error?: string }).error ?? `HTTP ${response.status}`}`);
    }
    return body as SettlementRecord;
  };

  let settlement = await readSettlement();
  step(`Initial status: ${settlement.status}`);
  info(`stored txHash=${settlement.txHash}`);

  if (smoke.waitForFinalization) {
    const startedAt = Date.now();
    while (settlement.status === 'submitted' && Date.now() - startedAt < smoke.timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, smoke.pollIntervalMs));
      settlement = await readSettlement();
      info(`poll status=${settlement.status} confirmedBlock=${settlement.confirmedBlock ?? 'n/a'}`);
    }
  }

  if (settlement.status === 'failed') {
    fail(`reconciliation: settlement failed (${settlement.failureReason ?? 'unknown reason'})`);
  }

  step(`Final status: ${settlement.status}`);
  if (settlement.status !== 'settled') {
    info('Settlement is still submitted. Re-run later or wait for the reconciler interval.');
  } else {
    info(`confirmedBlock=${settlement.confirmedBlock ?? 'unknown'}`);
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : 'Unknown smoke test failure');
});
