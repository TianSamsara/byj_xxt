import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { BridgeManager, bridgeJSON, searchRoots, inspectRoot, localBaseURL, modelChoices, harnessProfile } from '../core.mjs';

const key = 'a'.repeat(64);
const rows = [{ id: 'test-model', name: '测试模型', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }, { reasoningEffort: 'ultra' }] }];
async function fixture(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-codex-plugin-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const root = path.join(home, 'Documents', 'Codex', '2026-10-21', 'task', 'outputs', 'codex-harness-bridge');
  await fs.mkdir(path.join(root, 'state'), { recursive: true });
  await fs.writeFile(path.join(root, 'server.mjs'), '/* dsh-codex-bridge ChatGPT */');
  await fs.writeFile(path.join(root, 'Start-Bridge.ps1'), '# fixed launcher');
  await fs.writeFile(path.join(root, 'settings.json'), '{"port":17654}');
  await fs.writeFile(path.join(root, 'state', 'local-key'), key);
  let online = true, launched = 0, configured = 0;
  const fetcher = async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    assert.equal(options.redirect, 'error');
    if (!online) throw new Error('offline');
    return new Response(JSON.stringify(url.pathname === '/health' ? { service: 'dsh-codex-bridge' } : { data: rows }));
  };
  const manager = new BridgeManager({ home, fetcher, launcher: async () => { launched++; online = true; }, onConnected: async connection => { configured++; assert.equal(connection.candidate.key, key); } });
  return { manager, root, home, set online(value) { online = value; }, get launched() { return launched; }, get configured() { return configured; } };
}

test('only explicit loopback API roots are accepted', () => {
  assert.equal(localBaseURL('http://127.0.0.1:17654/v1/'), 'http://127.0.0.1:17654/v1');
  for (const url of ['https://example.com/v1', 'http://localhost:17654/v1', 'http://127.0.0.1:17654/v1?key=x', 'http://name:pass@127.0.0.1:17654/v1', 'http://127.0.0.1:17654/other']) assert.throws(() => localBaseURL(url));
});
test('bounded discovery finds a Harness bridge without returning its key', async t => {
  const f = await fixture(t);
  const found = await searchRoots({ home: f.home }); assert.equal(found.length, 1);
  assert.equal((await inspectRoot(f.root)).baseURL, 'http://127.0.0.1:17654/v1');
  const state = await f.manager.discover();
  assert.equal(state.phase, 'found'); assert.equal(state.candidates[0].online, true);
  assert.equal(JSON.stringify(state).includes(key), false);
});
test('connection remembers only file references and preferences, then restores them', async t => {
  const f = await fixture(t);
  const state = await f.manager.connect({ root: f.root, model: 'test-model', effort: 'high', autoStart: true, autoConnect: true });
  assert.equal(state.phase, 'connected'); assert.equal(state.models.length, 1); assert.equal(f.configured, 1);
  const memory = await fs.readFile(f.manager.file, 'utf8'); assert.equal(memory.includes(key), false);
  const restored = new BridgeManager({ home: f.home });
  assert.equal((await restored.load()).effort, 'high');
  await f.manager.forget(); assert.equal((await f.manager.load()).remembered, false);
  await assert.rejects(fs.stat(f.manager.file), { code: 'ENOENT' });
});
test('offline bridges launch only when requested and remembered fingerprints still match', async t => {
  const f = await fixture(t); f.online = false;
  await assert.rejects(f.manager.connect({ root: f.root, autoStart: false }), /未运行/);
  assert.equal(f.launched, 0);
  await f.manager.connect({ root: f.root, autoStart: true }); assert.equal(f.launched, 1);
  f.online = false; f.manager.state.phase = 'offline';
  await fs.appendFile(path.join(f.root, 'server.mjs'), '\nchanged');
  await assert.rejects(f.manager.reconnect(), /文件已变化/);
  assert.equal(f.launched, 1);
});
test('remembered offline bridges reconnect automatically with the same model and effort', async t => {
  const f = await fixture(t);
  await f.manager.connect({ root: f.root, effort: 'high' });
  f.online = false;
  const state = await f.manager.reconnect();
  assert.equal(state.phase, 'connected'); assert.equal(state.effort, 'high'); assert.equal(f.launched, 1);
});
test('unavailable models or unsupported effort never overwrite Harness configuration', async t => {
  const f = await fixture(t);
  await assert.rejects(f.manager.connect({ root: f.root, model: 'missing' }), /模型当前不可用/);
  assert.equal(f.configured, 0);
  await assert.rejects(f.manager.connect({ root: f.root, effort: 'ultra' }), /不支持/);
  assert.equal(f.configured, 0);
  assert.deepEqual(modelChoices([...rows, ...rows]).map(m => m.efforts), [['low', 'high']]);
});
test('a foreign service and a wrong key do not produce a connected state', async t => {
  const f = await fixture(t);
  f.manager.launcher = async () => {};
  f.manager.fetcher = async () => new Response('{"service":"another-service"}');
  await assert.rejects(f.manager.connect({ root: f.root }), /不是 Harness/);
  assert.equal(f.configured, 0);
  await assert.rejects(bridgeJSON(await inspectRoot(f.root), '/health', { fetcher: async () => new Response('{}', { status: 401 }) }), /密钥已更改/);
  await assert.rejects(bridgeJSON(await inspectRoot(f.root), 'http://other.test/health'), /拒绝访问/);
});
test('provider configuration preserves unrelated options and keeps secrets out of the public state', async t => {
  const f = await fixture(t); const candidate = await inspectRoot(f.root);
  const previous = { headers: { 'X-Local': 'yes' }, models: [{ id: 'test-model', contextWindow: 262144, maxTokens: 32768, input: ['text'] }], apiKeyEnv: 'OLD_KEY', cacheRetention: 'short' };
  const profile = harnessProfile({ candidate, models: modelChoices(rows), effort: 'high' }, previous);
  assert.equal(profile.headers.Authorization, `Bearer ${key}`);
  assert.equal(profile.headers['X-Local'], 'yes'); assert.equal(profile.cacheRetention, 'short');
  assert.equal(profile.models[0].contextWindow, 262144); assert.equal(profile.models[0].input[0], 'text');
  assert.equal(profile.apiKeyEnv, undefined); assert.equal(profile.reasoning, 'high');
  assert.deepEqual(previous.headers, { 'X-Local': 'yes' });
  const defaults = harnessProfile({ candidate, model: 'second', effort: '', models: [...modelChoices(rows), { id: 'second', name: 'Second', efforts: ['high'], defaultEffort: 'high' }] });
  assert.equal(defaults.reasoning, 'high');
});
test('errors are redacted and concurrent connection writes are rejected', async t => {
  const f = await fixture(t);
  f.manager.onConnected = async () => { throw new Error(`bad Bearer ${key}`); };
  await assert.rejects(f.manager.connect({ root: f.root }), /隐藏密钥/);
  assert.equal(JSON.stringify(f.manager.status()).includes(key), false);
  f.manager.busy = true;
  await assert.rejects(f.manager.connect({ root: f.root }), /请稍候/);
});
test('client contributes visible panels and forwards actions through its own Remote namespace', async () => {
  let plugin; const rows = [], calls = [];
  const React = { Component: class {}, createElement: (...args) => args };
  const context = vm.createContext({ setInterval: () => 1, clearInterval() {}, window: { __ModuleLoader__: { load: item => { plugin = item.factory(name => { assert.equal(name, 'react'); return React; }); } } }, document: { createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild() {} } } });
  vm.runInContext(await fs.readFile(new URL('../client.js', import.meta.url), 'utf8'), context);
  const remote = Object.fromEntries(['status', 'discover', 'connect', 'forget', 'reconnect'].map(method => [method, async (...args) => { calls.push({ method, args }); return { ok: true }; }]));
  const ctx = { remote: { $mount: async info => { assert.equal(info.descriptors.length, 5); } },
    get: key => { assert.equal(key, 'remote.codexBridge'); return remote; }, effect: effect => effect(),
    slots: { inject: (_name, effect) => effect(), register: (options, component) => { rows.push({ options, component }); return () => {}; } } };
  await plugin.apply(ctx);
  assert.ok(rows.some(r => r.options.name === 'sidebar.panellist' && r.options.label() === 'Codex 桥接'));
  assert.ok(rows.some(r => r.options.name === 'plugins.bundle.config'));
  const face = rows.find(r => r.options.name === 'main').options.inject();
  await face.api.connect({ root: 'local' });
  assert.equal(calls[0].method, 'reconnect');
  assert.equal(calls.at(-1).method, 'connect'); assert.equal(calls.at(-1).args[0].root, 'local');
});
