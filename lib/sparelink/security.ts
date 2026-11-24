export const MAX_BODY_BYTES = 16_384;

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch { return false; }
  const site = request.headers.get("sec-fetch-site");
  return site !== "cross-site";
}

export function isAdminEmail(email: string | null | undefined, configured: unknown): boolean {
  if (!email || typeof configured !== "string") return false;
  const allowed = configured.split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function acceptingSubmissions(configured: unknown): boolean {
  return configured === "true";
}

export function canReadOwnedRecord(userId: string | null | undefined, recordOwnerId: string): boolean {
  return Boolean(userId && userId === recordOwnerId);
}

export function sanitizeSubmissionKey(value: string | null): string | null {
  return value && /^[A-Za-z0-9_-]{10,80}$/.test(value) ? value : null;
}
