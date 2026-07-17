export function hasRequiredLockCoverage(
  debitedAmount: string,
  purchasedAmount: bigint,
  requestedPercentage: number,
  roundingTolerance = BigInt(10),
): boolean {
  if (!/^\d+$/.test(debitedAmount)) return false;
  if (
    purchasedAmount <= BigInt(0) ||
    !Number.isInteger(requestedPercentage) ||
    requestedPercentage < 51 ||
    requestedPercentage > 100
  ) return false;
  return BigInt(debitedAmount) + roundingTolerance >=
    (purchasedAmount * BigInt(requestedPercentage)) / BigInt(100);
}
