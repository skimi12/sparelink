import test from "node:test";
import assert from "node:assert/strict";
import { matchParts, normalizeManufacturer, normalizePartNumber, samePart, toPublicRecord, japaneseDate } from "../lib/sparelink/domain.ts";
import { acceptingSubmissions, canReadOwnedRecord, isAdminEmail, isSameOriginMutation, sanitizeSubmissionKey } from "../lib/sparelink/security.ts";

test("normalization keeps suffixes and structural separators", () => {
  assert.equal(normalizePartNumber("  ＣＪ２Ｍ － ＣＰＵ３１  "), "CJ2M-CPU31");
  assert.equal(normalizePartNumber("CJ2M–CPU31"), "CJ2M-CPU31");
  assert.notEqual(normalizePartNumber("AB-12"), normalizePartNumber("AB12"));
  assert.notEqual(normalizePartNumber("MR-J4-40A"), normalizePartNumber("MR-J4-40B"));
  assert.notEqual(normalizePartNumber("AB 12"), normalizePartNumber("AB12"));
});

test("exact matches require the same known manufacturer and full part number", () => {
  assert.equal(normalizeManufacturer(" オムロン "), "OMRON");
  assert.equal(samePart({ manufacturer: "オムロン", partNumber: "CJ2M-CPU31" }, { manufacturer: "omron", partNumber: "ＣＪ２Ｍ－ＣＰＵ３１" }), true);
  assert.equal(samePart({ manufacturer: "OMRON", partNumber: "CPU31" }, { manufacturer: "KEYENCE", partNumber: "CPU31" }), false);
  assert.equal(samePart({ manufacturer: "OMRON", partNumber: "CPU31" }, { manufacturer: "OMRON", partNumber: "CPU32" }), false);
  assert.equal(samePart({ manufacturer: "", partNumber: "" }, { manufacturer: "", partNumber: "" }), false);
});

const base = { manufacturer: "OMRON", partNumber: "CJ2M-CPU31", category: "plc", region: "東京都", status: "open", createdAt: "2026-11-25T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z" };
const request = { ...base, id: "request-1", kind: "request", quantity: 3, condition: "new", deadline: "2026-11-30", leadTimeDays: null };
const listing = { ...base, id: "listing-1", kind: "listing", quantity: 2, condition: "used", deadline: null, leadTimeDays: 7 };

test("a part-number candidate does not promise quantity, condition or deadline", () => {
  const [candidate] = matchParts([request], [listing], new Date("2026-11-25T00:00:00Z"));
  assert.equal(candidate.quantitySufficient, false);
  assert.equal(candidate.conditionCompatible, false);
  assert.equal(candidate.deadlineFeasible, false);
  assert.equal(candidate.dispatchBeforeDeadline, false);
  assert.equal(candidate.requiresVerification, true);
});

test("closed records are excluded and absent estimates stay unknown", () => {
  assert.deepEqual(matchParts([{ ...request, status: "closed" }], [listing]), []);
  assert.deepEqual(matchParts([request], [{ ...listing, status: "archived" }]), []);
  const [match] = matchParts([{ ...request, condition: "any" }], [{ ...listing, leadTimeDays: null }]);
  assert.equal(match.deadlineFeasible, null);
  assert.equal(match.dispatchBeforeDeadline, null);
  assert.equal(match.conditionCompatible, true);
});

test("shipping before a requested date never implies arrival is feasible", () => {
  const [match] = matchParts([request], [{ ...listing, leadTimeDays: 1 }], new Date("2026-11-25T00:00:00Z"));
  assert.equal(match.dispatchBeforeDeadline, true);
  assert.equal(match.deadlineFeasible, null);
  assert.equal(match.requiresVerification, true);
});

test("public catalog projection drops all sensitive and internal properties", () => {
  const result = toPublicRecord({ ...listing, ownerId: "private-user", contactEmail: "private@example.test", companyName: "秘密会社", contactName: "秘密担当者", description: "メール: private@example.test", submissionKey: "secret", manufacturerKey: "OMRON", isTest: true, futureSensitiveField: "private" });
  for (const key of ["ownerId", "contactEmail", "companyName", "contactName", "description", "submissionKey", "manufacturerKey", "isTest", "futureSensitiveField"]) assert.equal(Object.hasOwn(result, key), false);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("mutation protection requires exact origin and rejects missing, opaque or hostile origins", () => {
  const make = (origin, fetchSite) => new Request("https://sparelink.example/api/requests", { method: "POST", headers: { ...(origin === undefined ? {} : { origin }), ...(fetchSite ? { "sec-fetch-site": fetchSite } : {}) } });
  assert.equal(isSameOriginMutation(make("https://sparelink.example")), true);
  assert.equal(isSameOriginMutation(make(undefined)), false);
  assert.equal(isSameOriginMutation(make("null")), false);
  assert.equal(isSameOriginMutation(make("https://evil.example")), false);
  assert.equal(isSameOriginMutation(make("https://sparelink.example.evil.test")), false);
  assert.equal(isSameOriginMutation(make("https://sparelink.example", "cross-site")), false);
});

test("admin configuration and ownership fail closed", () => {
  assert.equal(isAdminEmail("owner@example.test", undefined), false);
  assert.equal(isAdminEmail("owner@example.test", "other@example.test"), false);
  assert.equal(isAdminEmail("OWNER@example.test", " other@example.test, owner@example.test "), true);
  assert.equal(isAdminEmail("owner@example.test.evil.test", "owner@example.test"), false);
  assert.equal(canReadOwnedRecord(null, "user-a"), false);
  assert.equal(canReadOwnedRecord("user-b", "user-a"), false);
  assert.equal(canReadOwnedRecord("user-a", "user-a"), true);
  for (const value of [undefined, null, true, false, "TRUE", "1", "false"]) assert.equal(acceptingSubmissions(value), false);
  assert.equal(acceptingSubmissions("true"), true);
});

test("idempotency identifiers and Japan date boundaries are explicit", () => {
  assert.equal(sanitizeSubmissionKey("good-key-12345"), "good-key-12345");
  assert.equal(sanitizeSubmissionKey("' OR 1=1 --"), null);
  assert.equal(sanitizeSubmissionKey("short"), null);
  assert.equal(japaneseDate(new Date("2026-11-24T15:00:00.000Z")), "2026-11-25");
  assert.equal(japaneseDate(new Date("2026-11-24T14:59:59.000Z")), "2026-11-24");
});
