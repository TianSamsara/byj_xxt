import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBridge, allowedOrigin, parseInput, MAX_BODY, Codex, selectEffort } from './bridge.mjs';

test('model capabilities select defaults and reject incompatible reasoning efforts', async () => {
  const fixture = { model: 'test-model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'fast' }, { reasoningEffort: 'medium' }] };
  const catalog = await Codex.prototype.models.call({ rpc: async () => ({ data: [fixture], nextCursor: null }) });
  assert.equal(catalog.data[0].supportedReasoningEfforts[0].reasoningEffort, 'low');
  assert.equal(selectEffort({ model: 'test-model' }, catalog), 'medium');
  assert.equal(selectEffort({ model: 'test-model', reasoning_effort: 'low' }, catalog), 'low');
  assert.throws(() => selectEffort({ model: 'test-model', reasoning_effort: 'ultra' }, catalog), /不支持/);
  assert.throws(() => selectEffort({ model: 'missing' }, catalog), /不可用/);
  assert.throws(() => parseInput({ model: 'test-model', reasoning_effort: {}, messages: [] }), /格式/);
});

test('selected effort and web search reach Codex while search commentary stays out of the answer', async () => {
 for (const search of [false, true]) {
  const calls = [];
  const client = {
    models: async () => ({ data: [{ id: 'test-model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] }),
    async rpc(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'config/read') return { config: { mcp_servers: { inherited: { command: 'unused' } } } };
      if (method === 'thread/start') return { thread: { id: 'test-thread' } };
      if (method === 'turn/start') queueMicrotask(() => {
        this.onEvent({ method: 'item/completed', params: { threadId: 'other-thread', item: { type: 'webSearch' } } });
        this.onEvent({ method: 'item/completed', params: { threadId: 'test-thread', item: { id: 'progress', type: 'agentMessage', phase: 'commentary', text: '检索中 {不是答案}' } } });
        if (search) this.onEvent({ method: 'item/completed', params: { threadId: 'test-thread', item: { id: 'search', type: 'webSearch', query: 'public facts' } } });
        this.onEvent({ method: 'item/completed', params: { threadId: 'test-thread', item: { id: 'answer', type: 'agentMessage', text: 'OK' } } });
        this.onEvent({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'completed' } } });
      });
      return {};
    }
  };
  const result = await Codex.prototype.answer.call(client, { model: 'test-model', web_search: search, reasoning_effort: 'high', messages: [{ role: 'user', content: 'hello' }] }, '.');
  assert.equal(calls.find(c => c.method === 'turn/start').params.effort, 'high');
  const thread = calls.find(c => c.method === 'thread/start').params;
  assert.equal(thread.config.web_search, search ? 'live' : 'disabled');
  assert.equal(thread.config['features.shell_tool'], false);
  assert.deepEqual(thread.config.mcp_servers, { inherited: { enabled: false } });
  assert.equal(thread.config['features.apps'], false);
  assert.equal(thread.sandbox, 'read-only');
  assert.match(thread.baseInstructions, search ? /可使用内置网页搜索/ : /网页搜索已关闭/);
  assert.equal(result.choices[0].message.content, 'OK');
  assert.deepEqual(result.web_search, { enabled: search, requests: search ? 1 : 0 });
 }
});

test('origin checks use hostname boundaries', () => {
  assert.equal(allowedOrigin('https://mooc1.chaoxing.com'), true);
  for (const origin of ['https://chaoxing.com.evil.test', 'null', 'file://chaoxing.com', 'https://evilchaoxing.com']) assert.equal(allowedOrigin(origin), false);
});
test('input rejects file access, remote images, and malformed messages', () => {
  const body = content => ({ model: 'example-model', messages: [{ role: 'user', content }] });
  assert.deepEqual(parseInput(body('hello')), [{ type: 'text', text: 'hello' }]);
  for (const content of [[{ type: 'localImage', path: 'C:/secret' }], [{ type: 'image_url', image_url: { url: 'http://127.0.0.1/secret' } }], null]) assert.throws(() => parseInput(body(content)));
  assert.throws(() => parseInput({ model: '../bad', messages: [] }));
  for (const value of ['live', 'false', 1, {}, null]) assert.throws(() => parseInput({ ...body('hello'), web_search: value }), /布尔/);
  assert.equal(parseInput(body([{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }]))[0].type, 'image');
});

class FakeCodex {
  constructor(_binary, _cwd, search) { this.search = search; }
  async init() {}
  async models() { return { data: [{ id: 'example-model' }] }; }
  async answer(body) { assert.equal(this.search, body.web_search === true); return { choices: [{ message: { content: 'OK' } }] }; }
  close() {}
}
test('HTTP authentication, origins, routing, payload limits, and compatible responses', async () => {
  const server = createBridge({ token: 'test-secret', Client: FakeCodex });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method: options.method || 'GET', headers: { Host: '127.0.0.1:17653', Authorization: 'Bearer test-secret', ...options.headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name.toLowerCase()] }, text: async () => text, json: async () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end(options.body);
  });
  try {
    assert.equal((await request('/v1/models', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await request('/health', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await request('/setup', { headers: { Authorization: '' } })).status, 403);
    const navigation = { Authorization: '', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
    const setup = await request('/setup', { headers: navigation });
    assert.equal(setup.status, 200);
    assert.match(await setup.text(), /复制密钥到剪贴板/);
    assert.equal(setup.headers.get('Access-Control-Allow-Origin'), undefined);
    assert.equal(setup.headers.get('Cache-Control'), 'no-store');
    assert.equal(setup.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(setup.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
    assert.match(setup.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
    for (const forbidden of [
      { Origin: 'https://mooc1.chaoxing.com' }, { Origin: 'https://evil.test' },
      { 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Dest': 'empty' }, { 'Sec-Fetch-Dest': 'iframe' }
    ]) {
      const blocked = await request('/setup', { headers: { ...navigation, ...forbidden } });
      assert.equal(blocked.status, 403);
      assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), undefined);
      assert.equal((await blocked.text()).includes('test-secret'), false);
    }
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'byj-codex-bridge');
    assert.equal((await health.json()).capabilities.web_search, true);
    assert.equal((await request('/v1/models', { headers: { Host: 'evil.test' } })).status, 403);
    assert.equal((await request('/v1/models', { headers: { Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await request('/nope')).status, 404);
    const models = await request('/v1/models', { headers: { Origin: 'https://mooc1.chaoxing.com' } });
    assert.equal(models.headers.get('Access-Control-Allow-Origin'), 'https://mooc1.chaoxing.com');
    assert.equal((await models.json()).data[0].id, 'example-model');
    const send = body => request('/v1/chat/completions', { method: 'POST', body });
    assert.equal((await send('{bad')).status, 400);
    assert.equal((await send('x'.repeat(MAX_BODY + 1))).status, 413);
    const answer = await send(JSON.stringify({ model: 'example-model', messages: [{ role: 'user', content: 'hello' }] }));
    assert.equal((await answer.json()).choices[0].message.content, 'OK');
    assert.equal((await send(JSON.stringify({ model: 'example-model', web_search: true, messages: [{ role: 'user', content: 'look up' }] }))).status, 200);
    assert.equal((await send(JSON.stringify({ model: 'example-model', web_search: 'live', messages: [{ role: 'user', content: 'look up' }] }))).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
