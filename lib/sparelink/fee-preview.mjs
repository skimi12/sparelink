/** @param {string} raw Whole-yen subtotal; local hypothetical estimate only. */
export function previewFee(raw) {
  if (typeof raw !== "string" || !/^[0-9]{1,8}$/.test(raw)) return null;
  const parts = Number(raw);
  if (!Number.isSafeInteger(parts) || parts < 1 || parts > 10000000) return null;
  const percentageFee = Math.ceil(parts * 15 / 100);
  const fee = Math.max(5000, percentageFee);
  return { parts, fee, combined: parts + fee, effectivePercent: fee / parts * 100, minimumApplied: percentageFee < 5000 };
}
