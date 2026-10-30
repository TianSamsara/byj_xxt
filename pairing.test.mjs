import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const pairing = readFileSync(new URL('./userscript/bridge-pairing.js', import.meta.url), 'utf8');
const code = pairing.slice(0, pairing.indexOf("  if (location.origin ==="));
const SETTINGS = 'xxt-assistant-settings', PENDING = 'xxt-assistant-bridge-pair-pending';
const endpoint = 'http://127.0.0.1:17653/v1/chat/completions', key = 'a'.repeat(64);
function fixture(saved = { provider: 'codex', endpoint, key: 'old', model: 'chosen', reasoningEffort: 'high', localBridgeAutoPair: true, homework: { bank: false } }) {
  const storage = new Map([[SETTINGS, structuredClone(saved)]]), opened = [], requests = [], status = { textContent: '' };
  const c = vm.createContext({ crypto: webcrypto, Uint8Array, Date, setTimeout: fn => setTimeout(fn, 1),
    GM_getValue: (name, fallback) => structuredClone(storage.get(name) ?? fallback),
    GM_setValue: (name, value) => storage.set(name, structuredClone(value)),
    GM_openInTab: url => { opened.push(url); queueMicrotask(() => {
      c.location.hash = new URL(url).hash;
      void c.handleBridgePairPage();
    }); },
    GM_xmlhttpRequest: req => {
      requests.push(req);
      assert.equal(req.headers.Authorization, `Bearer ${key}`);
      const body = req.url.endsWith('/health') ? { service: 'byj-codex-bridge' }
        : { data: [{ id: 'first' }, { id: 'chosen' }] };
      req.onload({ status: 200, responseText: JSON.stringify(body), finalUrl: req.url });
    },
    window: {}, location: { origin: 'http://127.0.0.1:17653', pathname: '/setup', hash: '' },
    document: { getElementById: id => id === 'status' ? status : { value: key } },
    history: { replaceState: (_state, _title, url) => assert.equal(url, '/setup') }
  });
  c.window.top = c.window;
  vm.runInContext(code, c);
  return { c, storage, opened, requests, status };
}

test('private pairing automatically verifies and saves the current key, retaining preferences and model', async () => {
  const f = fixture();
  const [first, second] = await Promise.all([f.c.requestBridgePair(), f.c.requestBridgePair()]);
  assert.equal(first.key, key); assert.equal(second.key, key);
  assert.equal(first.model, 'chosen'); assert.equal(first.reasoningEffort, 'high');
  assert.equal(first.homework.bank, false); assert.equal(first.localBridgeAutoPair, true);
  assert.equal(f.opened.length, 1); assert.equal(f.requests.length, 2);
  assert.match(f.opened[0], /^http:\/\/127\.0\.0\.1:17653\/setup#[a-f0-9]{64}$/);
  assert.ok(!f.opened[0].includes(key));
  assert.match(f.status.textContent, /已自动保存/);
  assert.ok(!f.status.textContent.includes(key));
  assert.equal(f.storage.get(PENDING).expires, 0);
  assert.equal(f.storage.get(PENDING).key, undefined);
});

test('first-time pairing switches only the connection and chooses an available model', async () => {
  const f = fixture({ provider: 'openai', endpoint: 'https://example.com', key: 'remote', model: 'remote-model', reasoningEffort: 'ultra', courseQuiz: { autoSubmit: false } });
  const result = await f.c.requestBridgePair();
  assert.equal(result.provider, 'codex'); assert.equal(result.endpoint, endpoint);
  assert.equal(result.model, 'first'); assert.equal(result.reasoningEffort, '');
  assert.equal(result.courseQuiz.autoSubmit, false);
});

test('ordinary, forged, expired and embedded setup visits cannot save a key', async () => {
  for (const mode of ['ordinary', 'forged', 'expired', 'embedded', 'other-origin', 'other-path']) {
    const f = fixture(); const original = f.storage.get(SETTINGS);
    const id = 'b'.repeat(64);
    f.storage.set(PENDING, { id, stamp: f.c.pairConnectionStamp(original), expires: Date.now() + 60000 });
    f.c.location.hash = `#${id}`;
    if (mode === 'ordinary') f.c.location.hash = '';
    if (mode === 'forged') f.c.location.hash = `#${'c'.repeat(64)}`;
    if (mode === 'expired') f.storage.get(PENDING).expires = 0;
    if (mode === 'embedded') f.c.window.top = {};
    if (mode === 'other-origin') f.c.location.origin = 'https://chaoxing.com';
    if (mode === 'other-path') f.c.location.pathname = '/evil';
    await f.c.handleBridgePairPage();
    assert.deepEqual(f.storage.get(SETTINGS), original, mode);
    assert.equal(f.requests.length, 0, mode);
  }
});

test('pairing rechecks settings after network waits and never overwrites another provider', async () => {
  const f = fixture();
  f.c.GM_xmlhttpRequest = req => {
    f.storage.set(SETTINGS, { provider: 'openai', endpoint: 'https://example.com', key: 'changed' });
    req.onload({ status: 200, responseText: req.url.endsWith('/health') ? '{"service":"byj-codex-bridge"}' : '{"data":[{"id":"first"}]}' });
  };
  await assert.rejects(f.c.requestBridgePair(), /未完成|改变/);
  assert.equal(f.storage.get(SETTINGS).key, 'changed');
});

test('redirects, wrong services, bad keys and missing models are never saved', async () => {
  for (const mode of ['redirect', 'wrong-service', 'bad-key', 'no-models', '401', 'network', 'timeout', 'abort']) {
    const f = fixture();
    const original = f.storage.get(SETTINGS);
    if (mode === 'bad-key') f.c.document.getElementById = id => id === 'status' ? f.status : { value: 'invalid' };
    f.c.GM_xmlhttpRequest = req => {
      if (mode === 'network') return req.onerror();
      if (mode === 'timeout') return req.ontimeout();
      if (mode === 'abort') return req.onabort();
      const body = req.url.endsWith('/health') ? { service: mode === 'wrong-service' ? 'foreign' : 'byj-codex-bridge' }
        : { data: mode === 'no-models' ? [] : [{ id: 'first' }] };
      req.onload({ status: mode === '401' ? 401 : 200, responseText: JSON.stringify(body), finalUrl: mode === 'redirect' ? 'http://evil.test' : req.url });
    };
    await assert.rejects(f.c.requestBridgePair(), /未完成/);
    assert.deepEqual(f.storage.get(SETTINGS), original, mode);
    assert.ok(!f.status.textContent.includes(key), mode);
  }
});

test('401 recovery requires opt-in and a fixed local endpoint, and honors newer saved keys', async () => {
  const f = fixture(); const connection = f.storage.get(SETTINGS);
  for (const patch of [{ localBridgeAutoPair: false }, { provider: 'openai' }, { endpoint: 'http://localhost:17653/v1/chat/completions' }])
    assert.equal(await f.c.recoverLocalBridgeKey({ ...connection, ...patch }), false);
  assert.equal(f.opened.length, 0);
  assert.equal(await f.c.recoverLocalBridgeKey(connection), true);
  assert.equal(f.storage.get(SETTINGS).key, key);
  assert.equal(await f.c.recoverLocalBridgeKey(connection), true);
  assert.equal(f.opened.length, 1);
});

test('failed automatic pairing is throttled across questions; manual retry remains available', async () => {
  const f = fixture(); const connection = f.storage.get(SETTINGS);
  f.c.GM_xmlhttpRequest = req => req.onerror();
  await assert.rejects(f.c.recoverLocalBridgeKey(connection), /未完成/);
  await assert.rejects(f.c.recoverLocalBridgeKey(connection), /暂未成功/);
  assert.equal(f.opened.length, 1);
  await assert.rejects(f.c.requestBridgePair(), /未完成/);
  assert.equal(f.opened.length, 2);
});

test('generated userscript matches only the fixed local setup route and exits before learning-page initialization', () => {
  const source = readFileSync(new URL('./byj.user.js', import.meta.url), 'utf8');
  assert.match(source.slice(0, source.indexOf('// ==/UserScript==')), /@match\s+http:\/\/127\.0\.0\.1:17653\/setup\r?\n/);
  assert.ok(source.indexOf('void handleBridgePairPage();') < source.indexOf('const CHANNEL ='));
  assert.doesNotMatch(pairing, /postMessage|window\.opener|GM_setClipboard|navigator\.clipboard/);
});

test('different task frames share one pending pairing instead of opening a tab for each question', async () => {
  const f = fixture(), other = fixture();
  other.c.GM_getValue = f.c.GM_getValue;
  other.c.GM_setValue = f.c.GM_setValue;
  const [a, b] = await Promise.all([f.c.requestBridgePair(), other.c.requestBridgePair()]);
  assert.equal(a.key, key); assert.equal(b.key, key);
  assert.equal(f.opened.length + other.opened.length, 1);
});

test('a blocked local-page script times out and a blocked new tab releases the pairing for retry', async () => {
  const f = fixture(); let now = Date.now();
  f.c.Date = { now: () => now };
  f.c.GM_openInTab = url => f.opened.push(url);
  f.c.setTimeout = callback => { now += 61000; callback(); };
  await assert.rejects(f.c.requestBridgePair(), /配对超时/);
  f.c.GM_openInTab = () => { throw new Error('blocked'); };
  await assert.rejects(f.c.requestBridgePair(), /无法打开/);
  assert.equal(f.storage.get(SETTINGS).key, 'old');
  assert.equal(f.storage.get(PENDING).failed, true);
});
