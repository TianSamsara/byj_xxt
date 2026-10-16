import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./byj.user.js', import.meta.url), 'utf8');
function load(context, name, next) {
  const plain = source.indexOf(`  function ${name}(`);
  const start = plain >= 0 ? plain : source.indexOf(`  async function ${name}(`);
  const end = source.indexOf(`  ${next}`, start + 1);
  assert.ok(start >= 0 && end > start, name);
  vm.runInContext(source.slice(start, end), context);
}
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
function answerContext() {
  const c = vm.createContext({ clean });
  load(c, 'blankValues', 'function essayValues(');
  load(c, 'essayValues', 'function blankHTML(');
  load(c, 'buildAnswerPrompt', 'function parseAIAnswer(');
  load(c, 'parseAIAnswer', 'async function askAI(');
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
