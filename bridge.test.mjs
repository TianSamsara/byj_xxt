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

test('selected effort is passed to turn/start', async () => {
  const calls = [];
  const client = {
    models: async () => ({ data: [{ id: 'test-model', defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }] }),
    async rpc(method, params) {
      calls.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'thread/start') return { thread: { id: 'test-thread' } };
      if (method === 'turn/start') queueMicrotask(() => {
        this.onEvent({ method: 'item/completed', params: { threadId: 'test-thread', item: { id: 'answer', type: 'agentMessage', text: 'OK' } } });
        this.onEvent({ method: 'turn/completed', params: { threadId: 'test-thread', turn: { status: 'completed' } } });
      });
      return {};
    }
  };
  await Codex.prototype.answer.call(client, { model: 'test-model', reasoning_effort: 'high', messages: [{ role: 'user', content: 'hello' }] }, '.');
  assert.equal(calls.find(c => c.method === 'turn/start').params.effort, 'high');
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
  assert.equal(parseInput(body([{ type: 'image_url', image_url: { url: 'data:image/png;base64,YQ==' } }]))[0].type, 'image');
});

class FakeCodex {
  async init() {}
  async models() { return { data: [{ id: 'example-model' }] }; }
  async answer() { return { choices: [{ message: { content: 'OK' } }] }; }
  close() {}
}
test('HTTP authentication, origins, routing, payload limits, and compatible responses', async () => {
  const server = createBridge({ token: 'test-secret', Client: FakeCodex });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const request = (url, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: url, method: options.method || 'GET', headers: { Host: '127.0.0.1:17653', Authorization: 'Bearer test-secret', ...options.headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: { get: name => res.headers[name.toLowerCase()] }, json: async () => JSON.parse(text) }));
    });
    req.on('error', reject); req.end(options.body);
  });
  try {
    assert.equal((await request('/v1/models', { headers: { Authorization: '' } })).status, 401);
    assert.equal((await request('/health', { headers: { Authorization: '' } })).status, 401);
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).service, 'byj-codex-bridge');
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
  } finally { await new Promise(resolve => server.close(resolve)); }
});
