import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./byj.user.js', import.meta.url), 'utf8');
function load(c, name, next) {
  const start = script.indexOf(`  function ${name}(`) >= 0 ? script.indexOf(`  function ${name}(`) : script.indexOf(`  async function ${name}(`);
  const end = script.indexOf(`  ${next}`, start + 1);
  assert.ok(start >= 0 && end > start); vm.runInContext(script.slice(start, end), c);
}

// Minimal DOM fixture: exercises the production traversal and visibility checks,
// rather than substituting a predetermined list of answer targets.
function fixture() {
  let order = 0;
  const allNodes = [];
  const doc = {
    getElementById: id => allNodes.find(n => n.id === id) || null,
    createElement: () => ({ content: { textContent: '' }, set innerHTML(value) { this.content.textContent = value.replace(/<br>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); } })
  };
  class Node {
    constructor(tag, attrs = {}, parent = null) {
      Object.assign(this, { nodeType: 1, tagName: tag.toUpperCase(), attrs, id: attrs.id || '', name: attrs.name || '', style: {}, children: [], parentElement: parent, ownerDocument: doc, isConnected: true, value: '', order: order++ });
      parent?.children.push(this); allNodes.push(this);
    }
    getAttribute(name) { return this.attrs[name] ?? null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    isSameNode(node) { return this === node; }
    compareDocumentPosition(node) { return this.order > node.order ? 2 : 4; }
    matches(selector) {
      return selector.split(',').some(part => {
        const s = part.trim();
        if (s.startsWith('.')) return (this.attrs.class || '').split(' ').includes(s.slice(1));
        if (s.startsWith('#')) return this.id === s.slice(1);
        if (s === 'input:not([type])') return this.tagName === 'INPUT' && !('type' in this.attrs);
        const m = s.match(/^(\w+)?\[([\w-]+)(?:="([^"]*)")?\]$/);
        if (m) return (!m[1] || this.tagName === m[1].toUpperCase()) && m[2] in this.attrs && (m[3] === undefined || this.attrs[m[2]] === m[3]);
        return this.tagName === s.toUpperCase();
      });
    }
    closest(selector) { for (let n = this; n; n = n.parentElement) if (n.matches(selector)) return n; return null; }
  }
  const body = new Node('body'); const question = new Node('div', { id: 'question6' }, body);
  const c = vm.createContext({ window: {}, unsafeWindow: {},
    all: (parent, selector) => allNodes.filter(n => n !== parent && parent.contains(n) && n.matches(selector)),
    clean: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
    getComputedStyle: n => ({ display: n.computedDisplay || n.style.display || 'block', visibility: 'visible', opacity: '1' }),
    sleep: async () => {}, dispatchInput: (node, value) => { node.value = value; }
  });
  load(c, 'displayVisible', 'function activeVideoVisible(');
  load(c, 'blankTargets', 'function blankValues(');
  load(c, 'blankValues', 'function essayValues(');
  load(c, 'essayValues', 'function blankHTML(');
  load(c, 'blankHTML', 'async function fillBlanks(');
  load(c, 'fillBlanks', 'async function fillLocal(');
  return { c, Node, body, question, doc };
}

function editorFixture(f, id, parent = f.question, sharedName = false) {
  const shell = new f.Node('div', { id, class: 'edui-editor' }, parent);
  const frame = new f.Node('iframe', { id: `${id}_iframe` }, shell);
  const backing = new f.Node('textarea', { id: `${id}_answer`, name: sharedName ? 'editorValue' : `${id}_answer` }, parent);
  backing.computedDisplay = 'none';
  const editor = { container: shell, iframe: frame, textarea: backing, key: id, options: { textarea: sharedName ? 'editorValue' : backing.name },
    isReady: true, setContent(html) { this.html = html; }, sync() { backing.value = this.html; }, getContentTxt() { return this.html.replace(/<br>/g, '\n'); } };
  return { shell, frame, backing, editor };
}

test('one editor registered through multiple objects and registries is one answer area and writes all points', async () => {
  const f = fixture(); const e = editorFixture(f, 'editor6');
  const toolbar = new f.Node('div', { class: 'edui-toolbar' }, f.question);
  new f.Node('input', { type: 'text' }, toolbar);
  f.c.unsafeWindow.UE = { instants: { editor6: e.editor } };
  f.c.window.UE = { instances: { alias6: { ...e.editor } } };
  const targets = f.c.blankTargets(f.question);
  assert.equal(targets.length, 1); assert.equal(targets[0].kind, 'editor');
  const result = await f.c.fillBlanks(f.question, ['主要步骤', '局限一', '局限二'], 'essay');
  assert.equal(result.ok, true, result.reason);
  assert.equal(e.editor.getContentTxt(), '主要步骤\n局限一\n局限二');
  assert.equal(e.backing.value, '主要步骤<br>局限一<br>局限二');
});
test('an empty instants table does not hide instances or pick an editor belonging to another question', () => {
  const f = fixture(); const e = editorFixture(f, 'editor6');
  const otherQuestion = new f.Node('div', { id: 'question7' }, f.body);
  const other = editorFixture(f, 'editor7', otherQuestion);
  f.c.window.UE = { instants: {}, instances: { editor6: e.editor, editor7: other.editor } };
  const targets = f.c.blankTargets(f.question);
  assert.equal(targets.length, 1); assert.equal(targets[0].editor, e.editor);
});

test('Chaoxing editable DIV wrappers around a registered UEditor are not independent answer areas', async () => {
  for (const attrs of [{ class: 'eidtDiv' }, { class: 'textDIV' }, { contenteditable: 'true' }]) {
    const f = fixture();
    const wrapper = new f.Node('div', attrs, f.question);
    const e = editorFixture(f, 'edui78', wrapper);
    f.c.window.UE = { instants: { edui78: e.editor } };
    const independent = new f.Node('textarea', { id: 'other-answer' }, f.question);
    assert.equal(f.c.blankTargets(f.question).length, 2, 'a real independent field must remain');
    independent.computedDisplay = 'none';
    const targets = f.c.blankTargets(f.question);
    assert.equal(targets.length, 1); assert.equal(targets[0].kind, 'editor');
    const result = await f.c.fillBlanks(f.question, ['步骤一', '步骤二', '局限一', '局限二'], 'essay');
    assert.equal(result.ok, true, result.reason);
    assert.equal(e.editor.getContentTxt(), '步骤一\n步骤二\n局限一\n局限二');
  }
});
test('CSS-hidden fields, hidden ancestors and toolbar controls are excluded while a textarea remains writable', async () => {
  const f = fixture();
  const answer = new f.Node('textarea', { id: 'visible-answer' }, f.question);
  const hidden = new f.Node('textarea', {}, f.question); hidden.computedDisplay = 'none';
  const ancestor = new f.Node('div', {}, f.question); ancestor.computedDisplay = 'none';
  new f.Node('input', { type: 'text' }, ancestor);
  const toolbar = new f.Node('div', { role: 'toolbar' }, f.question);
  new f.Node('input', { type: 'text' }, toolbar);
  assert.equal(f.c.blankTargets(f.question).length, 1);
  const result = await f.c.fillBlanks(f.question, '完整回答', 'essay');
  assert.equal(result.ok, true); assert.equal(answer.value, '完整回答');
});
test('a hidden inactive editor registered in the same question is not another answer area', () => {
  const f = fixture(); const active = editorFixture(f, 'active'); const inactive = editorFixture(f, 'old-editor');
  inactive.shell.computedDisplay = 'none';
  f.c.window.UE = { instants: { active: active.editor, inactive: inactive.editor } };
  const targets = f.c.blankTargets(f.question);
  assert.equal(targets.length, 1); assert.equal(targets[0].editor, active.editor);
});
test('two actual editors with a shared default textarea name remain separate for blanks', async () => {
  const f = fixture(); const first = editorFixture(f, 'editorA', f.question, true); const second = editorFixture(f, 'editorB', f.question, true);
  f.c.window.UE = { instants: { editorA: first.editor, editorB: second.editor } };
  assert.equal(f.c.blankTargets(f.question).length, 2);
  const essay = await f.c.fillBlanks(f.question, '完整回答', 'essay');
  assert.equal(essay.ok, false); assert.match(essay.reason, /2 个可编辑答题区/);
  const blank = await f.c.fillBlanks(f.question, ['甲', '乙'], 'blank');
  assert.equal(blank.ok, true, blank.reason);
  assert.equal(first.editor.getContentTxt(), '甲'); assert.equal(second.editor.getContentTxt(), '乙');
});
