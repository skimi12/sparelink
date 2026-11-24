import test from "node:test";
import assert from "node:assert/strict";
import { listingSchema, requestSchema, moderationSchema, statusSchema } from "../lib/sparelink/validation.ts";

const base = { manufacturer: "オムロン", partNumber: "ＣＪ２Ｍ－ＣＰＵ３１", category: "plc", quantity: 1, condition: "new", region: "東京都", description: "検査条件は個別確認", companyName: "テスト会社", contactName: "テスト担当", consent: true };
const request = { ...base, deadline: "2099-12-01" };
const listing = { ...base, leadTimeDays: 3 };

test("schemas accept the contract and preserve the submitted part-number notation", () => {
  assert.equal(requestSchema.parse(request).partNumber, "ＣＪ２Ｍ－ＣＰＵ３１");
  assert.equal(listingSchema.parse(listing).leadTimeDays, 3);
  assert.equal(requestSchema.safeParse({ ...request, condition: "any" }).success, true);
  assert.equal(listingSchema.safeParse({ ...listing, condition: "any" }).success, false);
});

test("consent and contact fields are mandatory and privileged fields cannot be injected", () => {
  assert.equal(requestSchema.safeParse({ ...request, consent: false }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, consent: undefined }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, companyName: " " }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, contactName: "" }).success, false);
  for (const field of ["ownerId", "contactEmail", "status", "reviewStatus", "isTest", "consentVersion"]) {
    assert.equal(requestSchema.safeParse({ ...request, [field]: "attacker-controlled" }).success, false, field);
  }
});

test("request deadlines reject nonexistent and past calendar dates", () => {
  for (const deadline of ["2099-02-29", "2099-02-31", "2099-13-01", "2099-00-01", "2000-01-01", "01/01/2099"]) {
    assert.equal(requestSchema.safeParse({ ...request, deadline }).success, false, deadline);
  }
  assert.equal(requestSchema.safeParse({ ...request, deadline: "2096-02-29" }).success, true);
});

test("numeric and bounded-text fields reject coercion and oversized input", () => {
  for (const quantity of [0, -1, 1.5, 100_001, "3", NaN, Infinity]) assert.equal(requestSchema.safeParse({ ...request, quantity }).success, false);
  for (const leadTimeDays of [-1, 0.5, 366, "3"]) assert.equal(listingSchema.safeParse({ ...listing, leadTimeDays }).success, false);
  assert.equal(listingSchema.safeParse({ ...listing, leadTimeDays: 0 }).success, true);
  assert.equal(requestSchema.safeParse({ ...request, description: "a".repeat(1201) }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, region: "unknown" }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, partNumber: "contact@example.test" }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, manufacturer: "contact@example.test" }).success, false);
  assert.equal(requestSchema.safeParse({ ...request, contactName: "hidden\u0000value" }).success, false);
});

test("status mutation cannot reopen or change record ownership and moderation is narrow", () => {
  assert.equal(statusSchema.safeParse({ status: "closed" }).success, true);
  assert.equal(statusSchema.safeParse({ status: "archived" }).success, true);
  assert.equal(statusSchema.safeParse({ status: "open" }).success, false);
  assert.equal(statusSchema.safeParse({ status: "closed", ownerId: "other" }).success, false);
  assert.equal(moderationSchema.safeParse({ reviewStatus: "approved" }).success, true);
  assert.equal(moderationSchema.safeParse({ reviewStatus: "approved", isTest: false }).success, false);
});
