/*
 * worker.js — Cloudflare Worker (or any edge function) that makes the KinoPUB
 * API usable from a browser-based MSX plugin.
 *
 * It does three things:
 *   1. Adds permissive CORS headers so the TV browser can read API responses.
 *   2. Serves POST /msx/keyboard — bridges MSX's native on-screen keyboard
 *      (execute:code) into an interaction request carrying the typed query.
 *   3. Serves GET  /sub?u=<encoded-url> — proxies cross-origin subtitle files
 *      so they can be read and converted to WebVTT by the player.
 *
 * Everything else is forwarded verbatim to the KinoPUB API host.
 *
 * Deploy:  wrangler deploy   (or paste into the Cloudflare dashboard editor)
 * Then set API_BASE in public/js/config.js to this Worker's URL.
 *
 * CREDENTIALS (recommended for public hosting like GitHub Pages):
 *   Store your client_id / client_secret as Worker secrets so they NEVER live
 *   in the client bundle / public repo:
 *       npx wrangler secret put KP_CLIENT_ID
 *       npx wrangler secret put KP_CLIENT_SECRET
 *   When present, they are injected into every /oauth2/* request below, and you
 *   can leave CLIENT_ID / CLIENT_SECRET blank in config.js.
 */

const API_HOST = "https://api.service-kp.com"; // primary KinoPUB API host

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "86400");
  h.set("Cache-Control", "no-store");
  h.delete("Set-Cookie");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function json(obj, status) {
  return cors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  }));
}

async function handle(request, env) {
  const url = new URL(request.url);

  // --- CORS preflight ---
  if (request.method === "OPTIONS") { return cors(new Response(null, { status: 204 })); }

  // --- (2) native keyboard bridge for search ---
  if (url.pathname === "/msx/keyboard" && request.method === "POST") {
    let body = {};
    try { body = JSON.parse(await request.text() || "{}"); } catch (e) { body = {}; }
    const code = body.code || "";
    const returnAction = (body.data && body.data.returnAction) || "";
    // MSX expects a wrapped response whose action gets executed on the client.
    return json({ response: { data: { action: returnAction, data: { q: code } } } });
  }

  // --- (3) subtitle proxy ---
  if (url.pathname === "/sub") {
    const target = url.searchParams.get("u");
    if (!target) { return json({ error: "missing u" }, 400); }
    let sub;
    try { sub = new URL(target); } catch (_) { return json({ error: "invalid_url" }, 400); }
    // Exact trusted CDN names only; empty by default. Never follow redirects.
    const hosts = String(env.SUBTITLE_HOSTS || "").split(",").map(h => h.trim()).filter(Boolean);
    if (request.method !== "GET" || sub.protocol !== "https:" || sub.username || sub.password ||
        (sub.port && sub.port !== "443") || !hosts.includes(sub.hostname)) {
      return json({ error: "subtitle_host_not_allowed" }, 403);
    }
    const r = await fetch(sub.href, { method: "GET", redirect: "manual" });
    if (r.status >= 300 && r.status < 400) { return json({ error: "redirect_blocked" }, 403); }
    const reader = r.body && r.body.getReader();
    const chunks = []; let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) {
          await reader.cancel();
          return json({ error: "subtitle_too_large" }, 413);
        }
        chunks.push(value);
      }
    }
    return cors(new Response(new Blob(chunks), { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
  }

  // No arbitrary upstream paths or credential-bearing URL query parameters.
  const oauth = url.pathname === "/oauth2/device" || url.pathname === "/oauth2/token";
  if (!oauth && !url.pathname.startsWith("/v1/")) { return json({ error: "not_found" }, 404); }
  if ((oauth && request.method !== "POST") || (!oauth && request.method !== "GET")) {
    return json({ error: "method_not_allowed" }, 405);
  }
  for (const key of ["access_token", "refresh_token", "client_secret", "client_id", "code"]) {
    if (url.searchParams.has(key)) { return json({ error: "credentials_in_url" }, 400); }
  }

  const target = API_HOST + url.pathname + url.search;
  const headers = new Headers({ "Accept": "application/json" });
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const init = { method: request.method, headers, redirect: "manual" };
  if (oauth) {
    const form = new URLSearchParams(await request.text());
    if (env.KP_CLIENT_ID) form.set("client_id", env.KP_CLIENT_ID);
    if (env.KP_CLIENT_SECRET) form.set("client_secret", env.KP_CLIENT_SECRET);
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    init.body = form.toString();
  }
  const apiResp = await fetch(target, init);
  if (apiResp.status >= 300 && apiResp.status < 400) { return json({ error: "redirect_blocked" }, 502); }
  return cors(apiResp);
}

// Cloudflare Workers entrypoint (module syntax) — receives `env` with secrets.
export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return json({ error: "proxy_error", detail: "upstream request failed" }, 502); }
  }
};

/* --- Service Worker syntax fallback (older Workers runtime, no `env`) ---
addEventListener("fetch", (event) => { event.respondWith(handle(event.request, self)); });
*/
