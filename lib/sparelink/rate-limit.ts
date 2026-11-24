export const RATE_ACQUIRE_SQL = "INSERT INTO sparelink_rate_limits (key, hits, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET hits = hits + 1 WHERE hits < ? RETURNING hits";
export const RATE_PRUNE_SQL = "DELETE FROM sparelink_rate_limits WHERE key IN (SELECT key FROM sparelink_rate_limits WHERE expires_at < ? LIMIT 100)";

export function rateWindow(userId: string, action: "create" | "update", now = Date.now()) {
  const hour = Math.floor(now / 3_600_000);
  return { key: `${userId}:${action}:${hour}`, expiresAt: (hour + 2) * 3_600_000, maximum: action === "create" ? 20 : 60 };
}
