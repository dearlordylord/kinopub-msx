import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
const originalFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url, init });
  return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
};
try {
  for (const url of ['http://127.0.0.1/', 'https://example.org/', 'https://cdn.example.org.evil.test/', 'https://user:pass@cdn.example.org/']) {
    const response = await worker.fetch(new Request('https://proxy.test/sub?u=' + encodeURIComponent(url)), { SUBTITLE_HOSTS: 'cdn.example.org' });
    assert.equal(response.status, 403);
  }
  assert.equal(calls.length, 0, 'untrusted subtitle URLs must never be fetched');
  assert.equal((await worker.fetch(new Request('https://proxy.test/arbitrary'), {})).status, 404);
  assert.equal((await worker.fetch(new Request('https://proxy.test/v1/user?access_token=secret'), {})).status, 400);
  await worker.fetch(new Request('https://proxy.test/oauth2/token', { method: 'POST', body: 'refresh_token=rt&client_secret=attacker' }), { KP_CLIENT_ID: 'id', KP_CLIENT_SECRET: 'secret' });
  assert.equal(calls[0].url, 'https://api.service-kp.com/oauth2/token');
  assert.equal(new URLSearchParams(calls[0].init.body).get('client_secret'), 'secret');
  assert.equal(calls[0].init.redirect, 'manual');
  await worker.fetch(new Request('https://proxy.test/v1/user', { headers: { Authorization: 'Bearer token' } }), {});
  assert.equal(calls[1].init.headers.get('Authorization'), 'Bearer token');
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.test/' } });
  assert.equal((await worker.fetch(new Request('https://proxy.test/sub?u=https%3A%2F%2Fcdn.example.org%2Fs.srt'), { SUBTITLE_HOSTS: 'cdn.example.org' })).status, 403);
} finally { globalThis.fetch = originalFetch; }

const requests = [];
const context = vm.createContext({ Date, XMLHttpRequest: class {
  open(method, url) { this.method = method; this.url = url; this.headers = {}; }
  setRequestHeader(key, value) { this.headers[key] = value; }
  send(body) { requests.push({ method: this.method, url: this.url, headers: this.headers, body }); }
}, localStorage: { getItem(key) { return { 'kp.access_token': 'access-secret', 'kp.refresh_token': 'refresh-secret', 'kp.expires_at': String(Date.now() + 3600000) }[key]; } } });
for (const file of ['config', 'util', 'store', 'api']) vm.runInContext(fs.readFileSync(new URL('../public/js/' + file + '.js', import.meta.url), 'utf8'), context);
context.KP_CONFIG.CLIENT_ID = 'client'; context.KP_CONFIG.CLIENT_SECRET = 'client-secret';
context.KP_API.getUser(() => {});
assert.equal(requests[0].url, 'https://api.service-kp.com/v1/user');
assert.equal(requests[0].headers.Authorization, 'Bearer access-secret');
context.KP_API.refresh(() => {});
assert.equal(requests[1].url, 'https://api.service-kp.com/oauth2/token');
assert.equal(new URLSearchParams(requests[1].body).get('refresh_token'), 'refresh-secret');
context.KP_API.requestDeviceCode(() => {});
assert.equal(requests[2].url, 'https://api.service-kp.com/oauth2/device');
assert.equal(new URLSearchParams(requests[2].body).get('client_secret'), 'client-secret');
console.log('Security checks passed: URL credential protection, secret injection, Bearer forwarding, subtitle allowlist and redirect blocking.');

// Smoke test: the anonymous menu renders; server-side credentials allow the
// activation flow without publishing the client_id/secret to the TV bundle.
let handler;
const storage = {};
const uiContext = vm.createContext({ Date, setInterval() { return 1; }, clearInterval() {},
  location: { href: 'https://dearlordylord.github.io/kinopub-msx/public/app.html' },
  localStorage: { getItem(key) { return storage[key] || null; }, setItem(key, value) { storage[key] = value; }, removeItem(key) { delete storage[key]; } },
  TVXPluginTools: { onReady(fn) { fn(); } },
  TVXInteractionPlugin: { setupHandler(value) { handler = value; }, init() { handler.init(); } }
});
for (const file of ['config', 'util', 'store', 'api', 'ui', 'app']) vm.runInContext(fs.readFileSync(new URL('../public/js/' + file + '.js', import.meta.url), 'utf8'), uiContext);
let content;
handler.handleRequest('menu', {}, value => { content = value; });
assert.equal(content.menu[0].label, 'Главная');
handler.handleRequest('home', {}, value => { content = value; });
assert.equal(content.pages[0].items[0].headline, 'Нет client_id');
uiContext.KP_CONFIG.PROXY_AUTH = true;
uiContext.KP_API.requestDeviceCode = cb => cb(null, { code: 'device', user_code: 'ABC123' });
handler.handleRequest('home', {}, value => { content = value; });
assert.equal(content.headline, 'Активация устройства');
assert.ok(JSON.stringify(content).includes('ABC123'));
console.log('Anonymous menu and Worker-only activation smoke checks passed.');
