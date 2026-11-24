import { env } from "cloudflare:workers";
import { and, count, desc, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getChatGPTUser, type ChatGPTUser } from "../../app/chatgpt-auth";
import { getDb } from "../../db";
import { sparelinkAudit, sparelinkRecords } from "../../db/schema";
import { CATEGORIES, matchParts, normalizeManufacturer, normalizePartNumber, toPublicRecord, type PublicRecord, type RecordKind } from "./domain";
import { acceptingSubmissions, canReadOwnedRecord, isAdminEmail, isSameOriginMutation, MAX_BODY_BYTES, sanitizeSubmissionKey } from "./security";
import { listingSchema, moderationSchema, requestSchema, statusSchema } from "./validation";
import { RATE_ACQUIRE_SQL, RATE_PRUNE_SQL, rateWindow } from "./rate-limit";

type RecordRow = typeof sparelinkRecords.$inferSelect;
type RuntimeConfig = { SPARELINK_ACCEPTING_SUBMISSIONS?: string; SPARELINK_ADMIN_EMAILS?: string };
const runtime = () => env as Cloudflare.Env & RuntimeConfig;
const CONSENT_VERSION = "pilot-2026-11-25";

export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string[]>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string[]>) {
    super(message); this.status = status; this.code = code; this.fields = fields;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin",
    "Vary": "Cookie, oai-authenticated-user-id, oai-authenticated-user-email",
  } });
}

export async function api(action: () => Promise<Response>): Promise<Response> {
  try { return await action(); }
  catch (error) {
    if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, error.status);
    if (error instanceof z.ZodError) {
      const fields: Record<string, string[]> = {};
      for (const issue of error.issues) (fields[issue.path.join(".") || "form"] ??= []).push(issue.message);
      return json({ error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください。", fields } }, 422);
    }
    // Do not log payloads, emails, SQL parameters, or platform bindings.
    console.error("SpareLink API request failed", { type: error instanceof Error ? error.name : "UnknownError" });
    return json({ error: { code: "INTERNAL_ERROR", message: "処理を完了できませんでした。時間をおいてお試しください。" } }, 500);
  }
}

function database() {
  if (!runtime().DB) throw new ApiError(503, "STORAGE_UNAVAILABLE", "保存機能を準備しています。まだ送信は完了していません。");
  return getDb();
}

async function user(): Promise<ChatGPTUser> {
  const current = await getChatGPTUser();
  if (!current) throw new ApiError(401, "AUTH_REQUIRED", "続けるにはログインしてください。");
  return current;
}

function admin(current: ChatGPTUser): boolean {
  return isAdminEmail(current.email, runtime().SPARELINK_ADMIN_EMAILS);
}

async function administrator(): Promise<ChatGPTUser> {
  const current = await user();
  if (!admin(current)) throw new ApiError(403, "ADMIN_REQUIRED", "この操作は管理者だけが利用できます。");
  return current;
}

function guardMutation(request: Request) {
  if (!isSameOriginMutation(request)) throw new ApiError(403, "ORIGIN_REJECTED", "この画面から操作をやり直してください。");
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new ApiError(415, "JSON_REQUIRED", "JSON形式で送信してください。");
}

async function body(request: Request): Promise<unknown> {
  guardMutation(request);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new ApiError(413, "BODY_TOO_LARGE", "送信内容が大きすぎます。");
  if (!request.body) throw new ApiError(400, "INVALID_JSON", "送信内容がありません。");
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(413, "BODY_TOO_LARGE", "送信内容が大きすぎます。"); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, "INVALID_JSON", "送信内容を読み取れませんでした。"); }
}

/** D1 upsert serializes quota acquisition; parallel requests cannot overrun the limit. */
async function rateLimit(current: ChatGPTUser, action: "create" | "update") {
  const db = runtime().DB;
  if (!db) throw new ApiError(503, "STORAGE_UNAVAILABLE", "保存機能を準備しています。");
  const now = Date.now(), window = rateWindow(current.userId, action, now);
  const result = await db.prepare(RATE_ACQUIRE_SQL)
    .bind(window.key, window.expiresAt, window.maximum).first<{ hits: number }>();
  if (!result) throw new ApiError(429, "RATE_LIMITED", "この時間帯の操作上限に達しました。1時間ほどおいてお試しください。");
  await db.prepare(RATE_PRUNE_SQL).bind(now).run();
}

function publicRecord(row: RecordRow): PublicRecord {
  return toPublicRecord(row as unknown as PublicRecord & Record<string, unknown>);
}

function ownedRecord(row: RecordRow) {
  return { ...publicRecord(row), companyName: row.companyName, contactName: row.contactName, contactEmail: row.contactEmail,
    description: row.description, reviewStatus: row.reviewStatus, isTest: row.isTest, consentVersion: row.consentVersion };
}

export async function getConfig(): Promise<Response> {
  const current = await getChatGPTUser();
  return json({ acceptingSubmissions: acceptingSubmissions(runtime().SPARELINK_ACCEPTING_SUBMISSIONS), authenticated: Boolean(current),
    isAdmin: current ? admin(current) : false, user: current ? { displayName: current.displayName, email: current.email } : null });
}

export async function getCatalog(request: Request): Promise<Response> {
  const url = new URL(request.url), kindInput = url.searchParams.get("kind") ?? "listings";
  if (kindInput !== "listings" && kindInput !== "requests") throw new ApiError(422, "INVALID_KIND", "一覧の種類を確認してください。");
  const query = (url.searchParams.get("q") ?? "").trim();
  const category = url.searchParams.get("category") ?? "";
  if (query.length > 100 || (category && !CATEGORIES.includes(category as typeof CATEGORIES[number]))) throw new ApiError(422, "INVALID_FILTER", "検索条件を確認してください。");
  const offsetValue = url.searchParams.get("offset") ?? "0";
  if (!/^\d{1,5}$/.test(offsetValue) || Number(offsetValue) > 10_000) throw new ApiError(422, "INVALID_OFFSET", "表示位置を確認してください。");
  const offset = Number(offsetValue), limit = 24;
  if (!acceptingSubmissions(runtime().SPARELINK_ACCEPTING_SUBMISSIONS)) return json({ items: [], total: 0, acceptingSubmissions: false, offset, limit });
  const filters = [eq(sparelinkRecords.kind, kindInput === "listings" ? "listing" : "request"), eq(sparelinkRecords.reviewStatus, "approved"), eq(sparelinkRecords.isTest, false), eq(sparelinkRecords.status, "open")];
  if (category) filters.push(eq(sparelinkRecords.category, category));
  if (query) filters.push(or(sql`instr(${sparelinkRecords.partKey}, ${normalizePartNumber(query)}) > 0`, sql`instr(${sparelinkRecords.manufacturerKey}, ${normalizeManufacturer(query)}) > 0`)!);
  const db = database(), where = and(...filters);
  const [rows, totals] = await Promise.all([
    db.select().from(sparelinkRecords).where(where).orderBy(desc(sparelinkRecords.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(sparelinkRecords).where(where),
  ]);
  return json({ items: rows.map(publicRecord), total: totals[0]?.total ?? 0, acceptingSubmissions: true, offset, limit });
}

export async function createRecord(request: Request, kind: RecordKind): Promise<Response> {
  guardMutation(request);
  const current = await user(), accepting = acceptingSubmissions(runtime().SPARELINK_ACCEPTING_SUBMISSIONS), isAdmin = admin(current);
  if (!accepting && !isAdmin) throw new ApiError(503, "PILOT_CLOSED", "現在はデモ公開中です。実際の調達依頼・在庫登録の受付は開始していません。");
  const input = kind === "request" ? requestSchema.parse(await body(request)) : listingSchema.parse(await body(request));
  const rawKey = request.headers.get("idempotency-key"), submissionKey = sanitizeSubmissionKey(rawKey);
  if (rawKey && !submissionKey) throw new ApiError(422, "INVALID_SUBMISSION_KEY", "送信識別子が正しくありません。");
  const db = database();
  if (submissionKey) {
    const previous = await db.select().from(sparelinkRecords).where(and(eq(sparelinkRecords.ownerId, current.userId), eq(sparelinkRecords.kind, kind), eq(sparelinkRecords.submissionKey, submissionKey))).limit(1);
    if (previous[0]) return json({ item: ownedRecord(previous[0]), reused: true });
  }
  await rateLimit(current, "create");
  const timestamp = new Date().toISOString();
  const value: typeof sparelinkRecords.$inferInsert = {
    id: crypto.randomUUID(), kind, ownerId: current.userId, manufacturer: input.manufacturer,
    manufacturerKey: normalizeManufacturer(input.manufacturer), partNumber: input.partNumber, partKey: normalizePartNumber(input.partNumber),
    category: input.category, quantity: input.quantity, condition: input.condition, region: input.region,
    deadline: "deadline" in input ? input.deadline ?? null : null, leadTimeDays: "leadTimeDays" in input ? input.leadTimeDays ?? null : null,
    description: input.description, companyName: input.companyName, contactName: input.contactName, contactEmail: current.email,
    status: "open", reviewStatus: "pending", isTest: !accepting, consentVersion: CONSENT_VERSION, submissionKey,
    createdAt: timestamp, updatedAt: timestamp,
  };
  const created = await db.insert(sparelinkRecords).values(value).onConflictDoNothing({ target: [sparelinkRecords.ownerId, sparelinkRecords.kind, sparelinkRecords.submissionKey] }).returning();
  if (!created[0] && submissionKey) {
    const existing = await db.select().from(sparelinkRecords).where(and(eq(sparelinkRecords.ownerId, current.userId), eq(sparelinkRecords.kind, kind), eq(sparelinkRecords.submissionKey, submissionKey))).limit(1);
    if (existing[0]) return json({ item: ownedRecord(existing[0]), reused: true });
  }
  if (!created[0]) throw new ApiError(409, "CREATE_CONFLICT", "同時に登録が行われました。一覧を確認してください。");
  return json({ item: ownedRecord(created[0]) }, 201);
}

export async function getRecord(id: string, kind: RecordKind): Promise<Response> {
  const current = await user();
  const rows = await database().select().from(sparelinkRecords).where(and(eq(sparelinkRecords.id, id), eq(sparelinkRecords.kind, kind), eq(sparelinkRecords.ownerId, current.userId))).limit(1);
  if (!rows[0] || !canReadOwnedRecord(current.userId, rows[0].ownerId)) throw new ApiError(404, "NOT_FOUND", "登録情報が見つかりません。");
  return json({ item: ownedRecord(rows[0]) });
}

export async function updateRecord(request: Request, id: string, kind: RecordKind): Promise<Response> {
  guardMutation(request);
  const current = await user(), input = statusSchema.parse(await body(request));
  const db = database();
  const rows = await db.select().from(sparelinkRecords).where(and(eq(sparelinkRecords.id, id), eq(sparelinkRecords.kind, kind), eq(sparelinkRecords.ownerId, current.userId))).limit(1);
  if (!rows[0] || !canReadOwnedRecord(current.userId, rows[0].ownerId)) throw new ApiError(404, "NOT_FOUND", "登録情報が見つかりません。");
  if (rows[0].status === "archived" && input.status !== "archived") throw new ApiError(409, "INVALID_STATUS", "アーカイブ済みの情報は変更できません。");
  await rateLimit(current, "update");
  const updated = await db.update(sparelinkRecords).set({ status: input.status, updatedAt: new Date().toISOString() }).where(and(eq(sparelinkRecords.id, id), eq(sparelinkRecords.ownerId, current.userId), ne(sparelinkRecords.status, "archived"))).returning();
  if (updated[0]) return json({ item: ownedRecord(updated[0]) });
  // Another request may have archived the row since the initial read.
  const latest = await db.select().from(sparelinkRecords).where(and(eq(sparelinkRecords.id, id), eq(sparelinkRecords.ownerId, current.userId))).limit(1);
  if (!latest[0]) throw new ApiError(404, "NOT_FOUND", "登録情報が見つかりません。");
  if (latest[0].status === "archived" && input.status !== "archived") throw new ApiError(409, "INVALID_STATUS", "アーカイブ済みの情報は変更できません。");
  return json({ item: ownedRecord(latest[0]) });
}

export async function getWorkspace(): Promise<Response> {
  const current = await user(), db = database();
  const own = await db.select().from(sparelinkRecords).where(eq(sparelinkRecords.ownerId, current.userId)).orderBy(desc(sparelinkRecords.createdAt)).limit(200);
  const other = acceptingSubmissions(runtime().SPARELINK_ACCEPTING_SUBMISSIONS)
    ? await db.select().from(sparelinkRecords).where(and(ne(sparelinkRecords.ownerId, current.userId), eq(sparelinkRecords.isTest, false), eq(sparelinkRecords.reviewStatus, "approved"), eq(sparelinkRecords.status, "open"))).limit(500) : [];
  const ownRequests = own.filter(item => item.kind === "request"), ownListings = own.filter(item => item.kind === "listing");
  const matches = [
    ...matchParts(ownRequests.filter(item => !item.isTest).map(publicRecord), other.filter(item => item.kind === "listing").map(publicRecord)),
    ...matchParts(other.filter(item => item.kind === "request").map(publicRecord), ownListings.filter(item => !item.isTest).map(publicRecord)),
    ...(admin(current) ? matchParts(ownRequests.filter(item => item.isTest).map(publicRecord), ownListings.filter(item => item.isTest).map(publicRecord)) : []),
  ];
  return json({ requests: ownRequests.map(ownedRecord), listings: ownListings.map(ownedRecord), matches, truncated: own.length === 200 || other.length === 500 });
}

export async function getAdmin(): Promise<Response> {
  await administrator();
  const db = database();
  const [counts, records] = await Promise.all([
    db.select({ kind: sparelinkRecords.kind, reviewStatus: sparelinkRecords.reviewStatus, isTest: sparelinkRecords.isTest, total: count() }).from(sparelinkRecords).groupBy(sparelinkRecords.kind, sparelinkRecords.reviewStatus, sparelinkRecords.isTest),
    db.select().from(sparelinkRecords).orderBy(desc(sparelinkRecords.createdAt)).limit(100),
  ]);
  return json({ counts, records: records.map(row => ({ ...publicRecord(row), reviewStatus: row.reviewStatus, isTest: row.isTest })), acceptingSubmissions: acceptingSubmissions(runtime().SPARELINK_ACCEPTING_SUBMISSIONS) });
}

export async function moderateRecord(request: Request, id: string): Promise<Response> {
  guardMutation(request);
  const current = await administrator(), input = moderationSchema.parse(await body(request)), db = database();
  const rows = await db.select().from(sparelinkRecords).where(eq(sparelinkRecords.id, id)).limit(1);
  if (!rows[0]) throw new ApiError(404, "NOT_FOUND", "登録情報が見つかりません。");
  if (rows[0].isTest && input.reviewStatus === "approved") throw new ApiError(409, "TEST_RECORD", "テスト登録は公開承認できません。");
  await rateLimit(current, "update");
  const timestamp = new Date().toISOString();
  const [updated] = await db.batch([
    db.update(sparelinkRecords).set({ reviewStatus: input.reviewStatus, updatedAt: timestamp }).where(eq(sparelinkRecords.id, id)).returning(),
    db.insert(sparelinkAudit).values({ id: crypto.randomUUID(), actorId: current.userId, recordId: id, action: `review:${input.reviewStatus}`, createdAt: timestamp }),
  ]);
  return json({ item: { ...publicRecord(updated[0]), reviewStatus: updated[0].reviewStatus, isTest: updated[0].isTest } });
}
