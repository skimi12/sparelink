/** Browser defenses compatible with Sites sign-in and Vinext streaming. */
export function hardenResponse(request: Request, response: Response): Response {
  // Cloudflare WebSocket upgrades must retain their special response object.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Vinext emits inline bootstrap scripts. This policy deliberately covers
  // framing, plugins, base URLs and form destinations without breaking hydration.
  // Multiple CSP policies apply together. Preserve stricter route policies,
  // including sandboxing on uploaded-image responses.
  headers.append("Content-Security-Policy", "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com");
  const path = new URL(request.url).pathname;
  const html = headers.get("content-type")?.toLowerCase().includes("text/html");
  if (html || path.startsWith("/api/") || request.headers.has("oai-authenticated-user-id")) {
    headers.set("Cache-Control", "private, no-store");
    const vary = new Set((headers.get("Vary") || "").split(",").map(value => value.trim()).filter(Boolean));
    for (const value of ["Cookie", "oai-authenticated-user-id", "Origin", "Sec-Fetch-Site"]) {
      if (![...vary].some(existing => existing.toLowerCase() === value.toLowerCase())) vary.add(value);
    }
    headers.set("Vary", [...vary].join(", "));
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
