/**
 * Operator Key Utility
 *
 * Generates operator-scoped Redis key suffixes for per-operator namespace isolation.
 * Backward-compatible: when operatorAddress is omitted, the original key is returned unchanged.
 */

/**
 * Returns a Redis key suffix for the given operator address, or an empty string
 * if no address is provided. The address is lowercased for case-insensitive matching.
 *
 * @example
 * operatorKey('0xABc') // ':0xabc'
 * operatorKey()        // ''
 */
export function operatorKey(operatorAddress?: string): string {
  if (!operatorAddress) return '';
  return `:${operatorAddress.toLowerCase()}`;
}
