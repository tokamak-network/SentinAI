import { getAddress, recoverTypedDataAddress } from 'viem';
import {
  canonicalizeAuthorization,
  canonicalizeResource,
  getPaymentAuthorizationDomain,
  getPaymentAuthorizationTypes,
} from '@/lib/marketplace/facilitator/typed-data';
import type {
  PaymentAuthorizationVerificationInput,
  PaymentAuthorizationVerificationResult,
} from '@/lib/marketplace/facilitator/types';

function invalid(reason: string): PaymentAuthorizationVerificationResult {
  return { isValid: false, reason };
}

export async function verifyPaymentAuthorization(
  input: PaymentAuthorizationVerificationInput
): Promise<PaymentAuthorizationVerificationResult> {
  if (input.network !== input.profile.network) {
    return invalid('Unsupported network/profile combination');
  }

  const authorization = canonicalizeAuthorization(input.authorization);
  const expectedResource = canonicalizeResource(input.expected.resource);

  if (authorization.asset !== getAddress(input.profile.tonAssetAddress)) {
    return invalid('Authorization asset does not match facilitator profile');
  }
  if (authorization.merchant !== getAddress(input.expected.merchant)) {
    return invalid('Authorization merchant mismatch');
  }
  if (authorization.asset !== getAddress(input.expected.asset)) {
    return invalid('Authorization asset mismatch');
  }
  if (authorization.amount !== input.expected.amount) {
    return invalid('Authorization amount mismatch');
  }
  if (authorization.resource !== expectedResource) {
    return invalid('Authorization resource mismatch');
  }
  if (input.now < authorization.validAfter) {
    return invalid('Authorization is not yet valid');
  }
  if (input.now > authorization.validBefore) {
    return invalid('Authorization has expired');
  }

  const signer = await recoverTypedDataAddress({
    domain: getPaymentAuthorizationDomain(input.profile),
    primaryType: 'PaymentAuthorization',
    types: getPaymentAuthorizationTypes(),
    message: authorization,
    signature: input.signature,
  });

  if (getAddress(signer) !== authorization.buyer) {
    return invalid('Authorization buyer/signer mismatch');
  }

  return {
    isValid: true,
    signer: authorization.buyer,
  };
}
