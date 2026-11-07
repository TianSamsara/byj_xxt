import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BridgeAuth, officialLoginURL } from './bridge-auth.mjs';
import { createBridge } from './bridge.mjs';
import { ClientPool } from './bridge-pool.mjs';

function fixture(options = {}) {
  const calls = [], clients = [];
  let account = options.account || null, completed = 0;
  class Client {
    constructor() { clients.push(this); }
    async init() {}
    close() { this.dead = true; }
    async rpc(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account, secret: 'private-oauth-token' };
      if (method === 'account/login/start') {
        if (options.failStart) throw new Error('private-oauth-token https://evil.test');
        if (options.early) { account = { type: 'chatgpt', planType: 'plus', accessToken: 'private-oauth-token' }; this.onEvent({ method: 'account/login/completed', params: { loginId: 'attempt', success: true } }); }
        return params.type === 'chatgpt' ? { type: 'chatgpt', loginId: 'attempt', authUrl: options.url || 'https://auth.openai.com/oauth/authorize?state=opaque' }
          : { type: 'chatgptDeviceCode', loginId: 'attempt', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' };
      }
      if (method === 'account/login/cancel') return {};
      throw new Error('Unexpected RPC');
    }
  }
  const auth = new BridgeAuth({ Client, rpcTimeoutMs: 100, loginTimeoutMs: options.loginTimeoutMs || 10000, onAuthenticated: () => { completed++; } });
  return { auth, Client, calls, clients, setAccount: value => { account = value; }, get completed() { return completed; } };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

test('only exact official HTTPS authorization hosts are accepted', () => {
  assert.equal(officialLoginURL('https://chatgpt.com/auth/authorize?state=opaque'), 'https://chatgpt.com/auth/authorize?state=opaque');
  for (const url of ['http://auth.openai.com/login', 'https://auth.openai.com.evil.test/', 'https://u:p@auth.openai.com/', 'https://auth.openai.com:444/', 'https://auth.openai.com/#token', 'javascript:alert(1)'])
    assert.throws(() => officialLoginURL(url));
});
test('account state is read without starting login or exposing emails and OAuth credentials', async () => {
  const f = fixture({ account: { type: 'chatgpt', email: 'private@example.com', planType: 'pro', accessToken: 'private-oauth-token' } });
  try {
    const state = await f.auth.status();
    assert.deepEqual(state.account, { type: 'chatgpt', planType: 'pro' });
    await f.auth.start('browser');
    assert.ok(f.calls.every(call => call.method === 'account/read'));
    assert.doesNotMatch(JSON.stringify(state), /private|email|Token/);
  } finally { f.auth.close(); }
});
test('browser authorization reuses a pending attempt and verifies completion before clearing warm inference clients', async () => {
  const f = fixture();
  try {
    const state = await f.auth.start('browser');
    assert.equal(state.login.status, 'pending'); assert.equal(f.auth.pending, true);
    const second = await f.auth.start('device'); assert.equal(second.login.loginId, state.login.loginId);
    assert.equal(f.calls.filter(call => call.method === 'account/login/start').length, 1);
    f.clients[0].onEvent({ method: 'account/login/completed', params: { loginId: 'foreign-attempt', success: true } });
    assert.equal(f.auth.view().login.status, 'pending');
    f.setAccount({ type: 'chatgpt', planType: 'plus', accessToken: 'private-oauth-token' });
    f.clients[0].onEvent({ method: 'account/login/completed', params: { loginId: 'attempt', success: true } });
    await turn();
    assert.equal(f.auth.view().login.status, 'succeeded'); assert.equal(f.completed, 1);
    assert.equal(f.auth.view().login.url, undefined); assert.equal(f.auth.pending, false);
    assert.doesNotMatch(JSON.stringify(f.auth.view()), /private-oauth-token/);
  } finally { f.auth.close(); }
});
test('completion arriving before the login response is still verified without requiring an open panel', async () => {
  const f = fixture({ early: true });
  try { await f.auth.start('browser'); await turn(); assert.equal(f.completed, 1); assert.equal(f.auth.view().login.status, 'succeeded'); }
  finally { f.auth.close(); }
});
test('device authorization and cancellation affect only the matching attempt, never account logout', async () => {
  const f = fixture({ account: { type: 'apiKey', apiKey: 'private-oauth-token' } });
  try {
    const state = await f.auth.start('device'); assert.equal(state.login.userCode, 'ABCD-1234');
    await assert.rejects(f.auth.cancel('stale'), /已改变/);
    assert.equal(f.auth.pending, true);
    const ended = await f.auth.cancel('attempt');
    assert.equal(ended.login.status, 'cancelled'); assert.equal(ended.login.userCode, undefined);
    assert.ok(f.calls.every(call => call.method !== 'account/logout'));
    assert.equal(f.clients[0].dead, true);
  } finally { f.auth.close(); }
});
test('expired login processes are released and success notifications alone never establish a signed-in account', async () => {
  const f = fixture({ loginTimeoutMs: 10 });
  try {
    await f.auth.start('browser');
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(f.auth.view().login.status, 'expired'); assert.equal(f.clients[0].dead, true);
  } finally { f.auth.close(); }
  const g = fixture();
  try {
    await g.auth.start('browser');
    g.clients[0].onEvent({ method: 'account/login/completed', params: { loginId: 'attempt', success: true, accessToken: 'private-oauth-token' } });
    await turn();
    assert.equal(g.auth.view().login.status, 'failed'); assert.equal(g.completed, 0);
  } finally { g.auth.close(); }
});
test('untrusted URLs and RPC failures never reach the browser as credential-bearing errors', async () => {
  for (const options of [{ failStart: true }, { url: 'https://evil.test/' }]) {
    const f = fixture(options);
    try { await assert.rejects(f.auth.start('browser'), error => /官方登录未能启动/.test(error.message) && !/private|evil/.test(error.message)); assert.equal(f.auth.pending, false); assert.equal(f.clients[0].dead, true); }
    finally { f.auth.close(); }
  }
});
test('stalled native RPCs are bounded and close the auth client', async () => {
  const f = fixture(); f.auth.rpcTimeoutMs = 10;
  f.Client.prototype.rpc = () => new Promise(() => {});
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(f.auth.status(), /无法读取/); assert.equal(f.clients[0].dead, true); }
  finally { clearTimeout(keepAlive); f.auth.close(); }
});
test('credential invalidation retires idle clients immediately and busy clients after their current operation', async () => {
  const f = fixture(), pool = new ClientPool({ Client: f.Client });
  try {
    const idle = pool.acquire(false), busy = pool.acquire(true);
    await Promise.all([idle.entry.ready, busy.entry.ready]); pool.release(idle.entry, true);
    pool.invalidate(); assert.equal(idle.entry.client.dead, true); assert.equal(busy.entry.client.dead, undefined);
    pool.release(busy.entry, true); assert.equal(busy.entry.client.dead, true);
  } finally { pool.close(); f.auth.close(); }
});
test('HTTP auth routes require local bearer authorization, reject token import, and block inference during sign-in', async () => {
  const f = fixture(), server = createBridge({ token: 'bridge-secret', Client: f.Client });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path, method: body ? 'POST' : 'GET',
      headers: { Host: '127.0.0.1:17653', Authorization: 'Bearer bridge-secret', ...headers } }, res => {
      let text = ''; res.on('data', x => { text += x; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  try {
    assert.equal((await request('/auth/status', null, { Authorization: '' })).status, 401);
    assert.equal((await request('/auth/login', { flow: 'browser' }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal(f.clients.length, 0);
    assert.equal((await request('/auth/login', { flow: 'browser', accessToken: 'private' })).status, 400);
    assert.equal((await request('/auth/login', { flow: 'apiKey' })).status, 400);
    const start = await request('/auth/login', { flow: 'browser' }); assert.equal(start.status, 200);
    const health = await request('/health'); assert.equal(health.body.active, 1); assert.equal(health.body.capabilities.chatgpt_login, true);
    assert.equal((await request('/v1/chat/completions', { model: 'test', messages: [] })).status, 409);
    assert.equal((await request('/auth/cancel', { loginId: start.body.login.loginId })).status, 200);
    assert.equal((await request('/health')).body.active, 0);
  } finally { await new Promise(resolve => server.close(resolve)); f.auth.close(); }
});
