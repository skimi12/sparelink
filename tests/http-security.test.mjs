import test from "node:test";
import assert from "node:assert/strict";
import { hardenResponse } from "../lib/http-security.ts";

test("route-specific sandbox and stricter referrer policies survive the wrapper", () => {
  const original = new Response(new Uint8Array([137,80,78,71]), { headers: { "Content-Type": "image/png", "Content-Security-Policy": "default-src 'none'; sandbox", "Referrer-Policy": "same-origin" } });
  const response = hardenResponse(new Request("https://service.test/api/photos/test-image"), original);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'; sandbox/);
  assert.match(response.headers.get("content-security-policy"), /object-src 'none'/);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
});

test("HTML responses retain streaming body, status, cookies and browser defenses", async () => {
  const input = new Response("<!doctype html><p>ready</p>", { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": "test=1; Secure; HttpOnly", "Vary": "Accept-Encoding" } });
  const response = hardenResponse(new Request("https://service.test/"), input);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<!doctype html><p>ready</p>");
  assert.equal(response.headers.get("set-cookie"), "test=1; Secure; HttpOnly");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin");
  assert.match(response.headers.get("content-security-policy"), /object-src 'none'/);
  assert.match(response.headers.get("content-security-policy"), /base-uri 'none'/);
  assert.match(response.headers.get("content-security-policy"), /form-action 'self'/);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'self' https:\/\/chatgpt\.com/);
  assert.match(response.headers.get("vary"), /Accept-Encoding/);
});

test("API errors and authenticated RSC responses cannot be shared in a cache", () => {
  const error = hardenResponse(new Request("https://service.test/api/session"), Response.json({ error: "unauthorized" }, { status: 401 }));
  assert.equal(error.status, 401);
  assert.equal(error.headers.get("cache-control"), "private, no-store");
  const rsc = hardenResponse(new Request("https://service.test/account?_rsc=one", { headers: { "oai-authenticated-user-id": "test-account" } }), new Response("private payload", { headers: { "Content-Type": "text/x-component", "Cache-Control": "public" } }));
  assert.equal(rsc.headers.get("cache-control"), "private, no-store");
  assert.match(rsc.headers.get("vary"), /oai-authenticated-user-id/);
});

test("anonymous immutable assets retain their caching policy", async () => {
  const response = hardenResponse(new Request("https://service.test/assets/app.js"), new Response("export {}", { headers: { "Content-Type": "text/javascript", "Cache-Control": "public, max-age=31536000, immutable" } }));
  assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.equal(await response.text(), "export {}");
});
