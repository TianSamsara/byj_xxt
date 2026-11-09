import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./byj.user.js', import.meta.url), 'utf8');
function load(context, name, next) {
  if (name === 'askAI' && !context.isExamRoute) context.isExamRoute = () => false;
  const plain = source.indexOf(`  function ${name}(`);
  const start = plain >= 0 ? plain : source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  ${next}`, start + 1);
  assert.ok(start >= 0 && end > start, name);
  vm.runInContext(source.slice(start, end), context);
}
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function answerContext() {
  const c = vm.createContext({ clean, settings: { provider: 'codex', codexWebSearch: true } });
  load(c, 'blankValues', 'function essayValues(');
  load(c, 'essayValues', 'function blankHTML(');
  load(c, 'buildAnswerPrompt', 'function parseAIAnswer(');
  load(c, 'parseAIAnswer', 'function ensureLocalWebSearch(');
  return c;
}
test('essays accept multiple points in one editor; blanks retain exact counts', () => {
  const c = answerContext();
  const raw = JSON.stringify({ status: 'ok', answer: ['第一点：定义。', '第二点：用途。'] });
  assert.equal(c.parseAIAnswer(raw, { type: 'essay' }), '第一点：定义。\n第二点：用途。');
  assert.throws(() => c.parseAIAnswer(raw, { type: 'blank', blankCount: 1 }), /空数不匹配/);
  assert.equal(c.essayValues('条件：x | y\n结果：A', 1)[0], '条件：x | y\n结果：A');
  assert.throws(() => c.essayValues('<img src=x>', 1), /已拒绝/);
  assert.throws(() => c.essayValues('answer', 2), /多个独立答题区/);
  const prompt = c.buildAnswerPrompt({ type: 'essay', title: '说明三个要点', options: [], blankCount: 1 }, 0);
  assert.match(prompt, /编辑器数量不是要点数量/);
  assert.doesNotMatch(prompt, /必须是恰好/);
});

test('per-question notes survive rescanning the same question, stay separate, and bypass stored answers', () => {
  const c = answerContext();
  c.frameId = 'test-frame'; c.busy = false;
  c.document = { createElement: () => ({ append(...nodes) { this.children = nodes; }, setAttribute() {}, addEventListener(_event, callback) { this.input = callback; } }) };
  const start = source.indexOf('  const questionSupplements =');
  vm.runInContext(source.slice(start, source.indexOf('  let panel, shadow, ui;', start)), c);
  const container = {};
  const item = { supplementId: c.questionSupplementId(container), pageUrl: 'https://mooc1.chaoxing.com/work', type: 'essay', title: '选择主修相关岗位', options: [] };
  const card = c.document.createElement();
  c.appendQuestionSupplement(card, item, 0);
  const input = card.children[0].children[0];
  input.value = '主修：人力资源管理'; input.input();
  const rescanned = { ...item, supplementId: c.questionSupplementId(container) };
  const withNote = c.withQuestionSupplement(rescanned);
  assert.equal(withNote.userSupplement, '主修：人力资源管理');
  assert.equal(rescanned.userSupplement, undefined);
  assert.equal(c.withQuestionSupplement({ ...item, title: '另一道题' }).userSupplement, undefined);
  assert.equal(c.withQuestionSupplement({ ...item, supplementId: c.questionSupplementId({}) }).userSupplement, undefined);
  assert.match(c.buildAnswerPrompt(withNote, 0), /"userSupplement":"主修：人力资源管理"/);
  c.GM_getValue = () => assert.fail('supplemented question read the cache');
  c.GM_setValue = () => assert.fail('supplemented question wrote to the cache');
  load(c, 'cacheAnswer', 'const BANK_TYPES');
  assert.equal(c.getCached(withNote), undefined);
  c.cacheAnswer(withNote, '答案');
  input.value = ''; input.input();
  assert.equal(c.withQuestionSupplement(rescanned).userSupplement, undefined);
});

test('exam routes exit the generated script before handlers or settings are touched', () => {
  for (const url of ['https://mooc1.chaoxing.com/exam-ans/exam/test/examcode/examnotes', 'https://mooc1.chaoxing.com/work?examId=123']) {
    const window = {}; window.parent = window.top = window;
    assert.doesNotThrow(() => vm.runInNewContext(source, { URL, location: new URL(url), window, document: {} }));
  }
});

test('exam guard recognizes an exam ancestor or embedded exam without blocking ordinary homework', () => {
  const guard = readFileSync(new URL('./userscript/exam-guard.js', import.meta.url), 'utf8');
  const window = {}; window.parent = window.top = window;
  const document = { querySelectorAll: () => [] };
  const c = vm.createContext({ URL, location: new URL('https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?workId=1'), window, document });
  vm.runInContext(guard.slice(0, guard.indexOf('  // Run before')), c);
  assert.equal(c.isExamRoute(), false);
  const exam = 'https://mooc1.chaoxing.com/exam-ans/exam/test/examcode/examnotes';
  document.querySelectorAll = () => [{ src: exam }];
  assert.equal(c.isExamRoute(), true);
  document.querySelectorAll = () => [];
  const parent = { location: new URL(exam) }; parent.parent = parent;
  window.parent = window.top = parent;
  assert.equal(c.isExamRoute(), true);
});

test('an exam opened after initialization blocks a new AI request', async () => {
  const c = vm.createContext({ isExamRoute: () => true, loadSettings: () => assert.fail('exam request loaded connection settings') });
  load(c, 'askAI', 'function cacheKey(');
  await assert.rejects(c.askAI({}), /考试页面已停用/);
});
test('type detection separates named essays and true blanks', () => {
  const c = vm.createContext({ clean, text: x => x || '', one: node => node.title || '', all: () => [], asArray: x => x || [], blankTargets: node => Array(node.count || 1).fill({}) });
  load(c, 'detectType', 'function getOptionElements(');
  const type = (attr, title = '', count = 1) => c.detectType({ getAttribute: name => name === 'typename' ? attr : '', title, count }, [], []);
  assert.equal(type('简答题'), 'essay');
  assert.equal(type('论述题'), 'essay');
  assert.equal(type('', '（简答题，10分）说明三个方面'), 'essay');
  assert.equal(type('填空题'), 'blank');
  assert.equal(type('', '说明三个方面'), 'essay');
  assert.equal(type('', '请填写____'), 'blank');
  assert.equal(type('', '无题型标记', 3), 'blank');
});
test('source requirements reflect the actual search setting without inventing sources', () => {
  const c = answerContext();
  const item = { type: 'essay', title: '检索并比较至少两个来源', options: [] };
  assert.match(c.buildAnswerPrompt(item, 0), /先实际检索和查阅/);
  assert.match(c.buildAnswerPrompt(item, 0), /完整 https 链接/);
  const choice = { type: 'single', title: '正确的是', options: [{ letter: 'A', text: '选项' }] };
  assert.match(c.buildAnswerPrompt(choice, 0), /不能附在选项字母或填空内容中/);
  assert.equal(c.parseAIAnswer('{"status":"ok","answer":"A","sources":[{"title":"参考","url":"https://example.com"}]}', choice), 'A');
  c.settings.codexWebSearch = false;
  assert.match(c.buildAnswerPrompt(item, 0), /本次网页搜索已关闭/);
  assert.match(c.buildAnswerPrompt(item, 0), /不要自行附加/);
  c.settings.provider = 'openai';
  assert.doesNotMatch(c.buildAnswerPrompt(item, 0), /本次允许使用内置网页搜索/);
  assert.throws(() => c.parseAIAnswer('{"status":"needs_review","answer":null,"reason":"来源不足"}', item), /来源不足/);
});
test('network capability checks reject an old bridge before making model requests', async () => {
  const c = vm.createContext({ URL, GM_xmlhttpRequest: request => request.onload({ status: 200, responseText: JSON.stringify({ service: 'byj-codex-bridge' }) }) });
  load(c, 'ensureLocalWebSearch', 'async function askAI(');
  await assert.rejects(c.ensureLocalWebSearch('http://127.0.0.1:17653/v1/chat/completions', 'secret'), /重启桥接/);
  c.GM_xmlhttpRequest = request => {
    assert.equal(request.url, 'http://127.0.0.1:17653/health');
    assert.equal(request.headers.Authorization, 'Bearer secret');
    request.onload({ status: 200, responseText: '{"service":"byj-codex-bridge","capabilities":{"web_search":true}}' });
  };
  await c.ensureLocalWebSearch('http://127.0.0.1:17653/v1/chat/completions', 'secret');
});
test('successful capability checks cache briefly and never cross connection keys', async () => {
  let requests = 0;
  const c = vm.createContext({ URL, GM_xmlhttpRequest: request => { requests++; request.onload({ status: 200, responseText: '{"service":"byj-codex-bridge","capabilities":{"web_search":true}}' }); } });
  load(c, 'ensureLocalWebSearch', 'async function askAI(');
  const endpoint = 'http://127.0.0.1:17653/v1/chat/completions';
  await c.ensureLocalWebSearch(endpoint, 'first'); await c.ensureLocalWebSearch(endpoint, 'first');
  assert.equal(requests, 1);
  await c.ensureLocalWebSearch(endpoint, 'second'); assert.equal(requests, 2);
  c.ensureLocalWebSearch.cached.expires = 0;
  await c.ensureLocalWebSearch(endpoint, 'second'); assert.equal(requests, 3);
});
test('only local Codex requests carry the saved web search setting', async () => {
  const requests = [];
  const c = vm.createContext({
    settings: { provider: 'codex', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', key: 'secret', model: 'test', codexWebSearch: true },
    validateProviderEndpoint: url => url, ensureLocalWebSearch: async () => {}, answerConfig: () => ({}),
    buildAnswerPrompt: () => '题目', ANSWER_SYSTEM_PROMPT: 'JSON', parseAIAnswer: raw => raw, log: () => {},
    GM_xmlhttpRequest: request => { requests.push(JSON.parse(request.data)); request.onload({ status: 200, responseText: '{"choices":[{"message":{"content":"OK"}}]}' }); }
  });
  c.loadSettings = () => c.settings;
  load(c, 'askAI', 'function cacheKey(');
  await c.askAI({}); assert.equal(requests.at(-1).web_search, true);
  c.settings.codexWebSearch = false;
  await c.askAI({}); assert.equal(requests.at(-1).web_search, false);
  c.settings.provider = 'openai';
  await c.askAI({}); assert.equal('web_search' in requests.at(-1), false);
});
test('a request keeps its original credentials and search choice while health is pending', async () => {
  let ready, sent;
  const c = vm.createContext({
    settings: { provider: 'codex', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', key: 'local-key', model: 'local-model', codexWebSearch: true },
    validateProviderEndpoint: url => url, ensureLocalWebSearch: () => new Promise(resolve => { ready = resolve; }), answerConfig: () => ({}),
    buildAnswerPrompt: (_item, _images, connection) => { assert.equal(connection.provider, 'codex'); return '题目'; },
    ANSWER_SYSTEM_PROMPT: 'JSON', parseAIAnswer: raw => raw,
    GM_xmlhttpRequest: request => { sent = request; request.onload({ status: 200, responseText: '{"choices":[{"message":{"content":"OK"}}]}' }); }
  });
  c.loadSettings = () => c.settings;
  load(c, 'askAI', 'function cacheKey(');
  const pending = c.askAI({});
  c.settings = { provider: 'openai', endpoint: 'https://example.com', key: 'other-key', model: 'other', codexWebSearch: false };
  ready(); await pending;
  assert.equal(sent.headers.Authorization, 'Bearer local-key');
  assert.equal(JSON.parse(sent.data).model, 'local-model');
  assert.equal(JSON.parse(sent.data).web_search, true);
});
test('saving and reopening AI settings preserves an explicitly disabled web search', () => {
  const nodes = new Map();
  const ui = id => { if (!nodes.has(id)) nodes.set(id, { value: '', checked: false }); return nodes.get(id); };
  for (const [id, value] of Object.entries({ endpoint: 'local', model: 'test', key: 'secret', provider: 'codex', 'reasoning-effort': 'high' })) ui(id).value = value;
  let saved;
  const c = vm.createContext({ ui, settings: { codexWebSearch: true }, validateProviderEndpoint: url => url, SETTINGS_KEY: 'settings',
    GM_setValue: (_key, value) => { saved = value; }, log() {}, toast() {},
    learningContext: () => ({}), detectLearningContext: () => ({}), syncAnswerInputs() {}, renderModelOptions() {},
    providers: { codex: { endpoint: 'local' } }, codexModelCatalog: []
  });
  c.loadSettings = () => c.settings;
  load(c, 'saveSettings', 'let toastTimer');
  load(c, 'syncInputs', 'function renderModelOptions(');
  c.saveSettings();
  assert.equal(saved.codexWebSearch, false);
  assert.equal(saved.reasoningEffort, 'high');
  ui('codex-web-search').checked = true;
  c.syncInputs(); assert.equal(ui('codex-web-search').checked, false);
});
test('essay writing preserves all points in one textarea', async () => {
  const c = answerContext();
  const input = { value: '' };
  c.blankTargets = () => [{ kind: 'input', node: input }];
  c.dispatchInput = (node, value) => { node.value = value; };
  c.sleep = async () => {};
  load(c, 'fillBlanks', 'async function fillLocal(');
  const result = await c.fillBlanks({ isConnected: true }, ['定义', '作用', '条件'], 'essay');
  assert.equal(result.ok, true);
  assert.equal(input.value, '定义\n作用\n条件');
  const blankResult = await c.fillBlanks({ isConnected: true }, ['甲', '乙'], 'blank');
  assert.equal(blankResult.ok, false);
  assert.match(blankResult.reason, /空数不匹配/);
});
test('reasoning picker follows supported efforts and saved selection', () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } }); return nodes.get(id); };
  node('provider').value = 'codex'; node('model').value = 'test-model';
  const c = vm.createContext({ ui: node, document: { createElement: () => ({}) }, settings: { model: 'test-model', reasoningEffort: 'high' }, codexModelCatalog: [{ id: 'test-model', defaultReasoningEffort: 'low', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] });
  load(c, 'renderReasoningOptions', 'function chooseProvider(');
  c.renderReasoningOptions();
  assert.equal(node('reasoning-effort').value, 'high');
  assert.equal(node('reasoning-effort').children.length, 3);
  c.renderReasoningOptions('ultra'); assert.equal(node('reasoning-effort').value, '');
  node('model').value = 'other'; c.renderReasoningOptions(); assert.equal(node('reasoning-effort').disabled, true);
  node('provider').value = 'openai'; c.renderReasoningOptions(); assert.equal(node('reasoning-field').hidden, true);
});

function bridgeContext(states = ['ready']) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, textContent: '', hidden: true, click() { links.push(this.href); } }); return nodes.get(id); };
  node('provider').value = 'codex'; node('endpoint').value = 'http://127.0.0.1:17653/v1/chat/completions'; node('key').value = 'local-secret';
  const requests = [], links = [], messages = [], clipboard = [], openedPages = [], blobs = [];
  let models = 0;
  const c = vm.createContext({ ui: node, providers: { codex: { endpoint: node('endpoint').value } },
    updateAccountLogin: async () => {},
    loadSettings: () => ({ localBridgeAutoPair: false }),
    sleep: async () => {}, log: message => messages.push(message), toast: message => messages.push(message), fetchModels: async () => { models++; },
    setTimeout, clearTimeout,
    Blob, Uint8Array, atob, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:https://chaoxing.com/installer-test'; } },
    GM_setClipboard: (value, _info, callback) => { clipboard.push(value); callback(); },
    GM_openInTab: (url, options) => openedPages.push({ url, ...options }),
    document: { documentElement: { appendChild() {} }, createElement: () => { const link = { click() { links.push(this.href); }, remove() {} }; return link; } },
    GM_xmlhttpRequest: request => {
      requests.push(request);
      const state = states.shift() || 'ready';
      if (state === 'pending') return;
      if (state === 'offline') return request.onerror();
      request.onload({ status: state === 'unauthorized' ? 401 : 200, responseText: JSON.stringify({ service: 'byj-codex-bridge' }) });
    }
  });
  const start = source.indexOf('  let bridgeCheckGeneration =');
  const end = source.indexOf('  function chooseProvider(', start);
  vm.runInContext(source.slice(start, end), c);
  return { c, node, requests, links, messages, clipboard, openedPages, blobs, get models() { return models; } };
}

test('startup link carries no key and waits for readiness before loading models', async () => {
  const f = bridgeContext(['offline', 'ready']);
  f.c.startLocalBridge();
  assert.deepEqual(f.links, ['byj-codex://start']);
  assert.equal(f.node('start-bridge').disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.node('bridge-status').textContent, '桥接已连接');
  assert.equal(f.node('start-bridge').disabled, false);
  assert.equal(f.models, 1);
  assert.ok(f.requests.every(request => request.url === 'http://127.0.0.1:17653/health'));
  assert.equal(f.requests[0].headers.Authorization, 'Bearer local-secret');
});

test('health detects a running bridge with a wrong or missing key without loading models', async () => {
  const f = bridgeContext(['unauthorized']);
  f.node('key').value = '';
  assert.equal(await f.c.checkLocalBridge(false, true), 'unauthorized');
  assert.match(f.node('bridge-status').textContent, /正确的本地连接密钥/);
  assert.equal(f.models, 0);
});

test('an empty key opens the local setup page without launching a protocol or leaking a key in its URL', () => {
  const f = bridgeContext(['unauthorized']);
  f.node('key').value = '';
  f.c.copyLocalBridgeKey();
  assert.equal(f.links.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.clipboard.length, 0);
  assert.equal(f.openedPages.length, 1);
  assert.equal(f.openedPages[0].url, 'http://127.0.0.1:17653/setup');
  assert.equal(f.openedPages[0].active, true);
  assert.equal(f.node('key').value, '');
});

test('a verified key copies through Tampermonkey and only reports success after the clipboard callback', async () => {
  const f = bridgeContext();
  await f.c.checkLocalBridge();
  let callback;
  f.c.GM_setClipboard = (value, _info, done) => { f.clipboard.push(value); callback = done; };
  f.c.copyLocalBridgeKey();
  assert.equal(f.node('copy-local-key').disabled, true);
  assert.deepEqual(f.clipboard, ['local-secret']);
  assert.equal(f.messages.length, 0);
  callback();
  assert.equal(f.node('copy-local-key').disabled, false);
  assert.match(f.messages[0], /已复制到剪贴板/);
  assert.equal(f.openedPages.length, 0);
  assert.equal(f.links.length, 0);
});

test('a failing clipboard API falls back to the local setup page without reporting success', () => {
  const f = bridgeContext();
  f.c.verifyLocalBridgeKey('local-secret', true);
  f.c.GM_setClipboard = () => { throw new Error('permission denied'); };
  f.c.copyLocalBridgeKey();
  assert.equal(f.node('copy-local-key').disabled, false);
  assert.equal(f.openedPages.length, 1);
  assert.equal(f.messages.some(message => /已复制到剪贴板/.test(message)), false);
});

test('local clipboard copying is unavailable for other providers', () => {
  const f = bridgeContext();
  f.node('provider').value = 'openai';
  f.c.startLocalBridge();
  f.c.copyLocalBridgeKey();
  assert.equal(f.links.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.clipboard.length, 0);
  assert.equal(f.openedPages.length, 0);
});

test('an old health response cannot apply after the connection key changes', async () => {
  const f = bridgeContext(['pending']);
  const operation = f.c.checkLocalBridge(false, true);
  f.node('key').value = 'new-secret';
  f.requests[0].onload({ status: 200, responseText: JSON.stringify({ service: 'byj-codex-bridge' }) });
  await operation;
  assert.equal(f.models, 0);
  assert.notEqual(f.node('bridge-status').textContent, '桥接已连接');
});

test('the installer saves the exact embedded ZIP without network, GM_download or credentials', async () => {
  const f = bridgeContext();
  f.c.GM_download = () => { throw new Error('download permission disabled'); };
  f.c.installLocalBridge();
  assert.equal(f.node('install-bridge').disabled, false);
  assert.deepEqual(f.links, ['blob:https://chaoxing.com/installer-test']); assert.equal(f.requests.length, 0);
  assert.equal(f.node('installer-save').download, 'install-byj-bridge.zip'); assert.equal(f.node('installer-save').hidden, false);
  assert.equal(f.blobs[0].type, 'application/zip');
  assert.deepEqual(Buffer.from(await f.blobs[0].arrayBuffer()), readFileSync(new URL('./install-byj-bridge.zip', import.meta.url)));
  assert.match(f.node('bridge-status').textContent, /已发起.*保存/); assert.doesNotMatch(f.node('bridge-status').textContent, /已下载|已安装|已连接/);
});
test('a blocked programmatic download leaves a clickable save link and reuses its small Blob', () => {
  const f = bridgeContext(); f.node('installer-save').click = () => {}; f.c.installLocalBridge();
  assert.equal(f.node('installer-save').hidden, false); assert.match(f.node('installer-save').href, /^blob:/);
  assert.match(f.node('bridge-status').textContent, /若没有出现下载/);
  f.c.installLocalBridge(); assert.equal(f.blobs.length, 1);
});
test('unsupported local downloads and corrupt packages give an actionable fallback without fetching or executing code', () => {
  const f = bridgeContext(); f.c.URL.createObjectURL = () => { throw new Error('unsupported'); }; f.c.installLocalBridge();
  assert.equal(f.node('install-bridge').disabled, false); assert.match(f.node('bridge-status').textContent, /浏览器未能创建.*GitHub 备用下载/);
  assert.equal(f.requests.length, 0); assert.equal(f.links.length, 0);
  const corrupted = bridgeContext(); corrupted.c.atob = () => 'bad'; corrupted.c.installLocalBridge();
  assert.match(corrupted.node('bridge-status').textContent, /内容不完整/); assert.equal(corrupted.blobs.length, 0);
  const other = bridgeContext(); other.node('provider').value = 'openai'; other.c.installLocalBridge(); assert.equal(other.blobs.length, 0);
  assert.match(source, /href="https:\/\/github.com\/TianSamsara\/byj_xxt\/blob\/main\/install-byj-bridge.zip"/);
});

test('unverified and rejected keys open the running bridge key page instead of copying stale input', async () => {
  const unverified = bridgeContext(); unverified.c.copyLocalBridgeKey();
  assert.equal(unverified.clipboard.length, 0); assert.equal(unverified.openedPages[0].url, 'http://127.0.0.1:17653/setup');
  const f = bridgeContext(['ready', 'unauthorized']); await f.c.checkLocalBridge();
  assert.equal(await f.c.checkLocalBridge(), 'unauthorized'); f.c.copyLocalBridgeKey();
  assert.equal(f.clipboard.length, 0); assert.equal(f.openedPages.length, 1); assert.equal(f.node('key').value, 'local-secret');
  const expired = bridgeContext(); expired.c.verifyLocalBridgeKey('local-secret', true);
  expired.c.Date = { now: () => Date.now() + 60000 }; expired.c.copyLocalBridgeKey();
  assert.equal(expired.clipboard.length, 0); assert.equal(expired.openedPages.length, 1);
});
test('model HTTP 401 provides current-key recovery and stale failures cannot invalidate a newly verified key', () => {
  const f = bridgeContext(); f.c.verifyLocalBridgeKey('local-secret', true);
  assert.equal(f.c.localBridgeAuthError({ status: 401 }, 'local-secret'), true);
  assert.match(f.node('bridge-status').textContent, /获取当前密钥.*保存设置/);
  f.c.copyLocalBridgeKey(); assert.equal(f.clipboard.length, 0); assert.equal(f.openedPages.length, 1);
  f.node('key').value = 'current-key'; f.c.verifyLocalBridgeKey('current-key', true);
  assert.equal(f.c.localBridgeAuthError({ status: 401 }, 'local-secret'), false);
  f.c.copyLocalBridgeKey(); assert.deepEqual(f.clipboard, ['current-key']);
});

test('automatic connection refreshes the key input after private storage synchronization and ignores another provider', async () => {
  const f = bridgeContext();
  const paired = { key: 'current', localBridgeAutoPair: true };
  f.c.settings = {};
  f.c.loadSettings = () => paired;
  f.c.requestBridgePair = async () => { f.node('key').value = paired.key; return paired; };
  await f.c.connectLocalBridge();
  assert.equal(f.node('key').value, 'current');
  assert.equal(f.node('auto-bridge-pair').checked, true);
  assert.equal(f.node('auto-connect-bridge').disabled, false);
  assert.equal(f.models, 1);
  assert.match(f.node('bridge-status').textContent, /自动保存/);
  f.c.requestBridgePair = async () => { f.node('provider').value = 'openai'; f.node('key').value = 'remote'; return paired; };
  await f.c.connectLocalBridge();
  assert.equal(f.node('key').value, 'remote');
  assert.equal(f.models, 1);
});

test('account panel opens only an official authorization page and refreshes models after confirmed login', async () => {
  const f = bridgeContext();
  f.c.URL = URL;
  f.c.clearTimeout = () => {};
  f.c.setTimeout = () => 1;
  f.node('account-open').removeAttribute = name => { delete f.node('account-open')[name]; };
  f.node('account-flow').value = 'device';
  let state = { account: null, login: { status: 'pending', flow: 'device', loginId: 'attempt', url: 'https://evil.test', userCode: 'ABCD-1234' } };
  f.c.GM_xmlhttpRequest = request => {
    assert.equal(request.headers.Authorization, 'Bearer local-secret');
    if (request.method === 'POST') assert.deepEqual(JSON.parse(request.data), { flow: 'device' });
    request.onload({ status: 200, responseText: JSON.stringify(state) });
  };
  const start = source.indexOf('  let accountRequestGeneration');
  vm.runInContext(source.slice(start, source.indexOf('  let bridgeCheckGeneration', start)), f.c);
  await f.c.updateAccountLogin('login');
  assert.equal(f.openedPages.length, 0);
  assert.match(f.node('account-status').textContent, /校验失败/);
  state.login.url = 'https://auth.openai.com/codex/device';
  await f.c.updateAccountLogin('login');
  assert.equal(f.openedPages[0].url, state.login.url);
  assert.equal(f.node('account-code').textContent, 'ABCD-1234');
  state = { account: { type: 'chatgpt', planType: 'plus' }, login: { status: 'succeeded' } };
  await f.c.updateAccountLogin();
  assert.match(f.node('account-status').textContent, /ChatGPT 已登录/);
  assert.equal(f.node('account-code').textContent, '');
  assert.equal(f.node('account-open').hidden, true);
  assert.equal(f.models, 1);
});

test('saving unrelated answer preferences retains the latest stored bridge credentials', () => {
  const live = { provider: 'codex', key: 'current', localBridgeAutoPair: true, homework: { bank: true } };
  let saved;
  const c = vm.createContext({ settings: { ...live, key: 'stale' }, loadSettings: () => live,
    GM_setValue: (_name, value) => { saved = value; }, SETTINGS_KEY: 'settings', toast() {},
    ui: () => ({ checked: false, value: 100 }), clamp: x => x });
  load(c, 'saveAnswerSettings', 'let videoEndedAt');
  c.saveAnswerSettings('hw');
  assert.equal(saved.key, 'current'); assert.equal(saved.localBridgeAutoPair, true);
  assert.equal(saved.homework.bank, false);
});
test('capability HTTP errors distinguish saved-key rejection from server errors and clear cached authorization', async () => {
  const c = vm.createContext({ URL, GM_xmlhttpRequest: request => request.onload({ status: 401 }) });
  load(c, 'ensureLocalWebSearch', 'async function askAI(');
  await assert.rejects(c.ensureLocalWebSearch('http://127.0.0.1:17653/v1/chat/completions', 'private-key'), error => error.status === 401 && /已保存的密钥.*保存设置/.test(error.message) && !error.message.includes('private-key'));
  assert.equal(c.ensureLocalWebSearch.cached, null);
  c.GM_xmlhttpRequest = request => request.onload({ status: 503 });
  await assert.rejects(c.ensureLocalWebSearch('http://127.0.0.1:17653/v1/chat/completions', 'private-key'), /HTTP 503/);
});
test('an already opened task frame reads newly saved connection settings for every AI request', async () => {
  const requests = []; let persisted = { provider: 'codex', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', key: 'new-key', model: 'test-model', codexWebSearch: false };
  const c = vm.createContext({ settings: { ...persisted, key: 'old-key' }, loadSettings: () => persisted,
    validateProviderEndpoint: url => url, ensureLocalWebSearch: async () => {}, answerConfig: () => ({}),
    buildAnswerPrompt: () => '题目', ANSWER_SYSTEM_PROMPT: 'JSON', parseAIAnswer: raw => raw, log() {},
    GM_xmlhttpRequest: request => { requests.push(request); request.onload({ status: 200, responseText: '{"choices":[{"message":{"content":"OK"}}]}' }); }
  });
  load(c, 'askAI', 'function cacheKey(');
  await c.askAI({}); assert.equal(requests[0].headers.Authorization, 'Bearer new-key');
  persisted = { ...persisted, key: 'latest-key' }; await c.askAI({});
  assert.equal(requests[1].headers.Authorization, 'Bearer latest-key'); assert.equal(c.settings.key, 'old-key');
});

test('AI recovers local HTTP 401 once using saved pairing, including when web search is disabled', async () => {
  for (const web of [false, true]) {
    let persisted = { provider: 'codex', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', key: 'old', model: 'test', codexWebSearch: web, localBridgeAutoPair: true };
    let recovered = 0, posts = 0;
    const c = vm.createContext({ loadSettings: () => persisted, validateProviderEndpoint: x => x,
      ensureLocalWebSearch: async (_url, token) => { if (web && token === 'old') { const e = new Error('401'); e.status = 401; throw e; } },
      answerConfig: () => ({}), buildAnswerPrompt: () => '题目', ANSWER_SYSTEM_PROMPT: 'JSON', parseAIAnswer: x => x, log() {},
      recoverLocalBridgeKey: async () => { recovered++; persisted = { ...persisted, key: 'new' }; return true; },
      GM_xmlhttpRequest: req => { posts++; if (req.headers.Authorization === 'Bearer old') req.onload({ status: 401 });
        else req.onload({ status: 200, responseText: '{"choices":[{"message":{"content":"OK"}}]}' }); }
    });
    load(c, 'askAI', 'function cacheKey(');
    assert.equal(await c.askAI({}), 'OK');
    assert.equal(recovered, 1); assert.equal(posts, web ? 1 : 2);
  }
});

test('AI never retries a second 401, another provider, a timeout, or a server failure', async () => {
  for (const mode of ['second401', 'remote401', 'timeout', 'server']) {
    const persisted = { provider: mode === 'remote401' ? 'openai' : 'codex', endpoint: mode === 'remote401' ? 'https://example.com' : 'http://127.0.0.1:17653/v1/chat/completions', key: 'old', model: 'test', localBridgeAutoPair: mode !== 'remote401' };
    let recovered = 0, posts = 0;
    const c = vm.createContext({ loadSettings: () => persisted, validateProviderEndpoint: x => x,
      answerConfig: () => ({}), buildAnswerPrompt: () => '题目', ANSWER_SYSTEM_PROMPT: 'JSON', parseAIAnswer: x => x, log() {},
      recoverLocalBridgeKey: async () => { recovered++; return true; },
      GM_xmlhttpRequest: req => { posts++; if (mode === 'timeout') req.ontimeout(); else req.onload({ status: mode === 'server' ? 503 : 401 }); }
    });
    load(c, 'askAI', 'function cacheKey(');
    await assert.rejects(c.askAI({}), /401|503|超时/);
    assert.equal(posts, mode === 'second401' ? 2 : 1);
    assert.equal(recovered, mode === 'second401' ? 1 : 0);
  }
});
test('fetching models routes a 401 to key recovery, then accepts a corrected key without retaining the error', async () => {
  const f = bridgeContext(); f.c.verifyLocalBridgeKey('local-secret', true);
  f.c.validateProviderEndpoint = value => value;
  f.c.listModels = async () => { throw Object.assign(new Error('模型列表返回 HTTP 401'), { status: 401 }); };
  load(f.c, 'fetchModels', 'function saveCourse(');
  await f.c.fetchModels(); assert.match(f.node('bridge-status').textContent, /获取当前密钥/);
  f.c.copyLocalBridgeKey(); assert.equal(f.clipboard.length, 0);
  f.node('key').value = 'new-correct-key';
  f.c.listModels = async () => ({ models: ['test-model'], catalog: [{ id: 'test-model' }] });
  f.c.renderModelOptions = () => {}; f.c.GM_setValue = () => {}; f.c.CODEX_MODELS_KEY = 'models';
  await f.c.fetchModels(); assert.match(f.node('bridge-status').textContent, /桥接已连接.*保存设置/);
  f.c.copyLocalBridgeKey(); assert.deepEqual(f.clipboard, ['new-correct-key']);
});
