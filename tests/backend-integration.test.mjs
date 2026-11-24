import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

// These boundaries exist only in the test bundle. Production modules are unchanged.
const contextKey = Symbol.for("sparelink.integration-test-context");
const context = { env: {}, headers: new Headers() };
globalThis[contextKey] = context;
const temporary = mkdtempSync(join(tmpdir(), "sparelink-service-tests-"));
const outfile = join(temporary, "server.mjs");
await build({
  entryPoints: [fileURLToPath(new URL("../lib/sparelink/server.ts", import.meta.url))],
  outfile, bundle: true, platform: "node", format: "esm", target: "node22", logLevel: "silent",
  plugins: [{ name: "test-platform-boundaries", setup(builder) {
    builder.onResolve({ filter: /^(cloudflare:workers|next\/headers|next\/navigation)$/ }, args => ({ path: args.path, namespace: "test-boundary" }));
    builder.onLoad({ filter: /.*/, namespace: "test-boundary" }, args => ({ contents:
      args.path === "cloudflare:workers" ? 'export const env = globalThis[Symbol.for("sparelink.integration-test-context")].env;' :
      args.path === "next/headers" ? 'export async function headers() { return globalThis[Symbol.for("sparelink.integration-test-context")].headers; }' :
      'export function redirect() { throw new Error("Unexpected redirect in API service test"); }', loader: "js" }));
  } }],
});
const service = await import(pathToFileURL(outfile).href);
after(() => { delete globalThis[contextKey]; rmSync(temporary, { recursive: true, force: true }); });

/** Minimal D1 adapter. SQL execution and transactions are provided by real SQLite. */
class D1Adapter {
  constructor(sqlite) { this.sqlite = sqlite; }
  prepare(sql) {
    const database = this.sqlite;
    class Prepared {
      constructor(parameters = []) { this.parameters = parameters; }
      bind(...parameters) { return new Prepared(parameters); }
      async first(column) {
        const row = database.prepare(sql).get(...this.parameters);
        return row ? column ? row[column] : row : null;
      }
      async raw() { return database.prepare(sql).all(...this.parameters).map(row => Object.values(row)); }
      async all() { return { success: true, results: database.prepare(sql).all(...this.parameters), meta: {} }; }
      async run() {
        const result = database.prepare(sql).run(...this.parameters);
        return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
      }
    }
    return new Prepared();
  }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.all());
      this.sqlite.exec("COMMIT");
      return result;
    } catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  for (const key of Object.keys(context.env)) delete context.env[key];
  Object.assign(context.env, { DB: new D1Adapter(sqlite), SPARELINK_ADMIN_EMAILS: "owner@example.test", SPARELINK_ACCEPTING_SUBMISSIONS: "false" });
  return sqlite;
}

function identity(id = null, email = null) {
  context.headers = new Headers(id ? { "oai-authenticated-user-id": id, "oai-authenticated-user-email": email } : {});
}
function mutation(path, data, { method = "POST", key, origin = "https://sparelink.test", type = "application/json", raw } = {}) {
  return new Request(`https://sparelink.test${path}`, { method, headers: { ...(origin ? { origin } : {}), ...(type ? { "content-type": type } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: raw ?? JSON.stringify(data) });
}
async function call(action) { const response = await service.api(action); return { status: response.status, body: await response.json(), headers: response.headers }; }
const base = { manufacturer: "オムロン", partNumber: "ＣＪ２Ｍ－ＣＰＵ３１", category: "plc", quantity: 1, condition: "new", region: "東京都", description: "テスト用の機密補足", companyName: "テスト企業", contactName: "テスト担当", consent: true };
const request = { ...base, deadline: "2099-12-01" };
const listing = { ...base, leadTimeDays: 3 };

test("actual API service enforces identity, ownership and durable test-record isolation", async () => {
  const sqlite = database();
  try {
    identity();
    assert.equal((await call(service.getWorkspace)).status, 401);
    assert.equal((await call(service.getAdmin)).status, 401);
    const config = await call(service.getConfig);
    assert.equal(config.body.authenticated, false);
    assert.equal(config.body.acceptingSubmissions, false);
    assert.equal(config.headers.get("cache-control"), "no-store");

    identity("regular-user", "regular@example.test");
    assert.equal((await call(() => service.createRecord(mutation("/api/requests", request), "request"))).status, 503);
    assert.equal((await call(service.getAdmin)).status, 403);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_records").get().count, 0);

    identity("owner-user", "owner@example.test");
    const created = await call(() => service.createRecord(mutation("/api/requests", request, { key: "test-request-12345" }), "request"));
    assert.equal(created.status, 201);
    assert.equal(created.body.item.isTest, true);
    assert.equal(created.body.item.reviewStatus, "pending");
    assert.equal(created.body.item.partNumber, "ＣＪ２Ｍ－ＣＰＵ３１");
    const id = created.body.item.id;
    const persisted = sqlite.prepare("SELECT part_number, part_key, contact_email FROM sparelink_records WHERE id = ?").get(id);
    assert.equal(persisted.part_number, "ＣＪ２Ｍ－ＣＰＵ３１");
    assert.equal(persisted.part_key, "CJ2M-CPU31");
    assert.equal(persisted.contact_email, "owner@example.test");
    assert.equal((await call(() => service.getRecord(id, "request"))).body.item.id, id);

    const repeated = await call(() => service.createRecord(mutation("/api/requests", request, { key: "test-request-12345" }), "request"));
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.item.id, id);
    assert.equal(repeated.body.reused, true);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_records").get().count, 1);

    const stocked = await call(() => service.createRecord(mutation("/api/listings", listing), "listing"));
    assert.equal(stocked.status, 201);
    assert.equal((await call(service.getWorkspace)).body.matches.length, 1);
    assert.equal((await call(() => service.moderateRecord(mutation(`/api/admin/records/${id}`, { reviewStatus: "approved" }, { method: "PATCH" }), id))).status, 409);

    identity("other-user", "other@example.test");
    assert.equal((await call(() => service.getRecord(id, "request"))).status, 404);
    assert.equal((await call(() => service.updateRecord(mutation(`/api/requests/${id}`, { status: "closed" }, { method: "PATCH" }), id, "request"))).status, 404);
    assert.equal((await call(() => service.moderateRecord(mutation(`/api/admin/records/${id}`, { reviewStatus: "approved" }, { method: "PATCH" }), id))).status, 403);
    assert.deepEqual((await call(service.getWorkspace)).body.matches, []);

    identity("owner-user", "owner@example.test");
    const closed = await call(() => service.updateRecord(mutation(`/api/requests/${id}`, { status: "closed" }, { method: "PATCH" }), id, "request"));
    assert.equal(closed.status, 200);
    assert.equal(closed.body.item.status, "closed");
    assert.deepEqual((await call(service.getWorkspace)).body.matches, []);
    assert.deepEqual((await call(() => service.getCatalog(new Request("https://sparelink.test/api/catalog?kind=listings")))).body.items, []);
  } finally { sqlite.close(); }
});

test("live catalog needs moderation and never exposes private record fields", async () => {
  const sqlite = database();
  try {
    context.env.SPARELINK_ACCEPTING_SUBMISSIONS = "true";
    identity("supplier-user", "supplier@example.test");
    const created = await call(() => service.createRecord(mutation("/api/listings", listing), "listing"));
    assert.equal(created.status, 201);
    assert.equal(created.body.item.isTest, false);
    const id = created.body.item.id;
    const catalog = () => service.getCatalog(new Request("https://sparelink.test/api/catalog?kind=listings&q=CJ2M"));
    identity();
    assert.equal((await call(catalog)).body.total, 0);
    identity("owner-user", "owner@example.test");
    const reviewed = await call(() => service.moderateRecord(mutation(`/api/admin/records/${id}`, { reviewStatus: "approved" }, { method: "PATCH" }), id));
    assert.equal(reviewed.status, 200);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_audit").get().count, 1);
    identity();
    const visible = await call(catalog);
    assert.equal(visible.body.total, 1);
    const item = visible.body.items[0];
    assert.equal(item.id, id);
    for (const field of ["companyName", "contactName", "contactEmail", "description", "ownerId", "submissionKey", "manufacturerKey", "partKey"]) assert.equal(Object.hasOwn(item, field), false, field);
    assert.equal(JSON.stringify(visible.body).includes("supplier@example.test"), false);
  } finally { sqlite.close(); }
});

test("service body guards and validation reject requests before storing records", async () => {
  const sqlite = database();
  try {
    identity("owner-user", "owner@example.test");
    const submit = (data, options) => call(() => service.createRecord(mutation("/api/requests", data, options), "request"));
    assert.equal((await submit(request, { origin: "https://attacker.example" })).status, 403);
    assert.equal((await submit(request, { origin: null })).status, 403);
    assert.equal((await submit(request, { type: "text/plain" })).status, 415);
    assert.equal((await submit(request, { raw: "{" })).status, 400);
    assert.equal((await submit(request, { raw: "a".repeat(16_385) })).status, 413);
    assert.equal((await submit({ ...request, quantity: 0 })).status, 422);
    assert.equal((await submit({ ...request, ownerId: "spoofed-owner" })).status, 422);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_records").get().count, 0);
  } finally { sqlite.close(); }
});

test("concurrent service creates respect quota and identical idempotency keys persist once", async (t) => {
  const sqlite = database();
  try {
    t.mock.method(Date, "now", () => Date.parse("2026-11-25T00:15:00Z"));
    identity("owner-user", "owner@example.test");
    const duplicates = await Promise.all(Array.from({ length: 4 }, () => call(() => service.createRecord(mutation("/api/requests", request, { key: "concurrent-request-key" }), "request"))));
    assert.equal(duplicates.filter(result => result.status === 201).length, 1);
    assert.equal(duplicates.filter(result => result.status === 200).length, 3);
    assert.equal(new Set(duplicates.map(result => result.body.item.id)).size, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_records").get().count, 1);
    // Use a separate authenticated actor so this checks the documented full quota.
    context.env.SPARELINK_ADMIN_EMAILS += ",second@example.test";
    identity("quota-user", "second@example.test");
    const burst = await Promise.all(Array.from({ length: 22 }, () => call(() => service.createRecord(mutation("/api/requests", request), "request"))));
    assert.equal(burst.filter(result => result.status === 201).length, 20);
    assert.equal(burst.filter(result => result.status === 429).length, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sparelink_records").get().count, 21);
  } finally { sqlite.close(); }
});
