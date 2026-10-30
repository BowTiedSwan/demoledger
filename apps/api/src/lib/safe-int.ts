/**
 * Money helpers. Postgres bigint arrives from `pg` as a base-10 string.
 * Convert to a JS number only after asserting it is a safe integer.
 */
export function toSafeNumber(value: string | number | bigint, what = 'value'): number {
  const big = typeof value === 'bigint' ? value : BigInt(value);
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError(`${what} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(big);
}
