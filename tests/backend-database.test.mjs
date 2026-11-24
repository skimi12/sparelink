import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { RATE_ACQUIRE_SQL, RATE_PRUNE_SQL, rateWindow } from "../lib/sparelink/rate-limit.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  return db;
}

test("production rate-limit SQL enforces quota per user and time window", () => {
  const db = database();
  try {
    const acquire = (owner, time, action = "create") => {
      const window = rateWindow(owner, action, time);
      return db.prepare(RATE_ACQUIRE_SQL).get(window.key, window.expiresAt, window.maximum);
    };
    const now = Date.parse("2026-11-25T00:15:00Z");
    for (let attempt = 1; attempt <= 20; attempt++) assert.equal(acquire("owner-a", now).hits, attempt);
    assert.equal(acquire("owner-a", now), undefined);
    assert.equal(acquire("owner-b", now).hits, 1);
    assert.equal(acquire("owner-a", now + 3_600_000).hits, 1);
    assert.equal(acquire("owner-a", now, "update").hits, 1);
    assert.equal(db.prepare("SELECT hits FROM sparelink_rate_limits WHERE key = ?").get(rateWindow("owner-a", "create", now).key).hits, 20);
  } finally { db.close(); }
});

test("bounded maintenance removes expired quota records only", () => {
  const db = database();
  try {
    const now = Date.parse("2026-11-25T00:15:00Z");
    for (const timestamp of [now - 4 * 3_600_000, now]) {
      const window = rateWindow("owner-a", "create", timestamp);
      db.prepare(RATE_ACQUIRE_SQL).get(window.key, window.expiresAt, window.maximum);
    }
    db.prepare(RATE_PRUNE_SQL).run(now);
    const rows = db.prepare("SELECT key FROM sparelink_rate_limits").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].key, rateWindow("owner-a", "create", now).key);
  } finally { db.close(); }
});

test("empty migrations contain no customer or sample records", () => {
  const db = database();
  try {
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sparelink_records").get().total, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sparelink_audit").get().total, 0);
  } finally { db.close(); }
});
