from pathlib import Path

source = Path('upstream.user.js').read_text(encoding='utf-8')
s = source
def replace(old, new):
    global s
    if old not in s:
        raise RuntimeError('源码不匹配: ' + old[:90])
    s = s.replace(old, new)

replace('// @version      0.13.2', '// @version      0.14.3')
replace('// @description  学习通页面内控制面板：', '// @description  支持本地 Codex 登录、模型与思考强度选择；学习通页面内控制面板：')
# Prevent the published upstream version from overwriting this local build.
s = '\n'.join(line for line in s.split('\n') if not line.startswith(('// @downloadURL', '// @updateURL')))
replace('// @grant        unsafeWindow', '// @grant        GM_info\n// @grant        unsafeWindow')
replace('  const providers = {', "  const providers = {\n    codex: { label: '本地 Codex（ChatGPT 登录）', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', model: '', models: [] },")
replace('<option value="openai">', '<option value="codex">本地 Codex（ChatGPT 登录）</option><option value="openai">')
replace('>API Key<input', '>API Key / 本地连接密钥<input')
replace('Key 保存在油猴本地存储；', '本地 Codex：先启动 bridge.mjs，将终端显示的本地连接密钥填入 Key，获取模型后保存。仅打开 Codex 窗口还不够；需要本机 Codex CLI 的 ChatGPT 登录状态。本地密钥不是 OpenAI API Key。Key 保存在油猴本地存储；')
replace("    const url = validateEndpoint(settings.endpoint);\n    const wantImages", "    const url = validateProviderEndpoint(settings.endpoint, settings.provider);\n    const wantImages")
replace("        timeout: 60000,", "        timeout: settings.provider === 'codex' ? 190000 : 60000,")
replace("    const url = modelsURL(endpoint, provider);", "    validateProviderEndpoint(endpoint, provider);\n    const url = modelsURL(endpoint, provider);")
replace("    log(`已选择 ${preset.label}，请填写该服务商的 API Key`);", "    log(ui('provider').value === 'codex' ? '请先启动本地桥接，填写终端显示的本地连接密钥，然后获取模型' : `已选择 ${preset.label}，请填写该服务商的 API Key`);")
replace("validateEndpoint(ui('endpoint').value.trim())", "validateProviderEndpoint(ui('endpoint').value.trim(), ui('provider').value)")
replace("  function modelsURL(endpoint, provider) {", """  function validateProviderEndpoint(endpoint, provider) {
    const url = validateEndpoint(endpoint);
    if (provider === 'codex' && url !== providers.codex.endpoint)
      throw new Error('本地 Codex 地址必须为 ' + providers.codex.endpoint + '，防止本地密钥发送到其他地址');
    return url;
  }

  function modelsURL(endpoint, provider) {""")
# Do not apply a response from a provider that the user has since switched away from.
replace("      renderModelOptions(models, ui('model').value);\n      log(`已从接口", "      if (ui('provider').value !== provider || ui('endpoint').value.trim() !== endpoint || ui('key').value.trim() !== key) { log('连接设置已改变，已忽略旧模型列表，请重新获取'); return; }\n      renderModelOptions(models, ui('model').value);\n      log(`已从接口")
replace("      if (preset) {\n        renderModelOptions(preset.models", "      if (ui('provider').value !== provider) return;\n      if (provider === 'codex') { log(`${error.message}；请检查桥接服务和本地连接密钥`); }\n      else if (preset) {\n        renderModelOptions(preset.models")
# A missing courseQuiz setting in schema v2 must not silently enable submissions.
replace('courseQuiz: { ...answerDefaults, autoSubmit: true,', 'courseQuiz: { ...answerDefaults, autoSubmit: false,')
# Bound malformed model catalog payloads before rendering DOM options.
replace('.filter(name => typeof name === \'string\' && name.length <= 120 && name.trim());', ".filter(name => typeof name === 'string' && name.length <= 120 && name.trim()).slice(0, 1000);")
replace("    if (!['https:', 'http:'].includes(url.protocol))", "    if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能包含账号、密码、查询参数或片段');\n    if (!['https:', 'http:'].includes(url.protocol))")
replace("  let settings = loadSettings();", """  let settings = loadSettings();
  const CODEX_MODELS_KEY = 'xxt-assistant-codex-models';
  let codexModelCatalog = GM_getValue(CODEX_MODELS_KEY, []);
  if (!Array.isArray(codexModelCatalog)) codexModelCatalog = [];
""")
replace("model: providers.deepseek.model, key: '', delay: 1200,", "model: providers.deepseek.model, key: '', reasoningEffort: '', delay: 1200,")
replace('            <div class="row"><button class="action secondary" id="get-models">', '''            <label class="field" id="reasoning-field" hidden>思考强度<select class="field" id="reasoning-effort" aria-label="选择思考强度"></select></label>
            <p class="hint" id="reasoning-hint" hidden></p>
            <div class="row"><button class="action secondary" id="get-models">''')
replace("            resolve(unique);", """            if (provider === 'codex') {
              const catalog = rows.slice(0, 1000).filter(row => row && typeof row.id === 'string').map(row => ({
                id: row.id, defaultReasoningEffort: typeof row.defaultReasoningEffort === 'string' ? row.defaultReasoningEffort : '',
                supportedReasoningEfforts: (Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts : [])
                  .filter(entry => entry && typeof entry.reasoningEffort === 'string' && /^[a-z]{1,20}$/.test(entry.reasoningEffort))
                  .slice(0, 20).map(entry => ({ reasoningEffort: entry.reasoningEffort, description: String(entry.description || '').slice(0, 300) }))
              }));
              resolve({ models: unique, catalog });
            } else resolve(unique);""")
replace("      const models = await listModels(endpoint, provider, key);", "      const result = await listModels(endpoint, provider, key);\n      const models = Array.isArray(result) ? result : result.models;")
replace("      renderModelOptions(models, ui('model').value);", "      if (provider === 'codex') { codexModelCatalog = result.catalog; GM_setValue(CODEX_MODELS_KEY, codexModelCatalog); }\n      renderModelOptions(models, ui('model').value);")
replace("renderModelOptions(providers[ui('provider').value]?.models || [settings.model], settings.model);", "renderModelOptions(ui('provider').value === 'codex' ? codexModelCatalog.map(row => row.id) : providers[ui('provider').value]?.models || [settings.model], settings.model);")
replace("      ui('model').append(empty); return;", "      ui('model').append(empty); renderReasoningOptions(''); return;")
replace("    ui('model').value = list.includes(selected) ? selected : list[0];", "    ui('model').value = list.includes(selected) ? selected : list[0];\n    renderReasoningOptions();")
replace("  function chooseProvider() {", """  function renderReasoningOptions(selected = settings.model === ui('model').value ? settings.reasoningEffort || '' : '') {
    const isCodex = ui('provider').value === 'codex';
    ui('reasoning-field').hidden = !isCodex;
    ui('reasoning-hint').hidden = !isCodex;
    const select = ui('reasoning-effort');
    select.replaceChildren();
    const model = codexModelCatalog.find(row => row.id === ui('model').value);
    const labels = { none: '无', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: '极高' };
    const options = model?.supportedReasoningEfforts || [];
    const automatic = document.createElement('option'); automatic.value = '';
    automatic.textContent = model?.defaultReasoningEffort ? `模型默认（${labels[model.defaultReasoningEffort] || model.defaultReasoningEffort} / ${model.defaultReasoningEffort}）` : '模型默认';
    select.append(automatic);
    for (const entry of options) {
      const option = document.createElement('option'); option.value = entry.reasoningEffort;
      option.textContent = `${labels[entry.reasoningEffort] || entry.reasoningEffort}（${entry.reasoningEffort}）`;
      option.title = entry.description; select.append(option);
    }
    select.value = options.some(entry => entry.reasoningEffort === selected) ? selected : '';
    select.disabled = !options.length;
    ui('reasoning-hint').textContent = !options.length ? '请重新获取模型以加载支持的思考档位；未提供档位时使用模型默认。' : '档位由本机 Codex 返回；较高强度通常需要更长等待并消耗更多额度。更改后点击保存设置。';
  }

  function chooseProvider() {""")
replace("    if (!preset) return;\n    ui('endpoint')", "    if (!preset) { renderReasoningOptions(''); return; }\n    ui('endpoint')")
replace("    ui('provider').onchange = chooseProvider;", "    ui('provider').onchange = chooseProvider;\n    ui('model').onchange = () => renderReasoningOptions('');")
replace("    settings = { ...settings, endpoint, model, key,", "    settings = { ...settings, endpoint, model, key,\n      reasoningEffort: ui('provider').value === 'codex' ? ui('reasoning-effort').value : '',")
replace("        data: JSON.stringify({ model: settings.model,", "        data: JSON.stringify({ model: settings.model,\n          ...(settings.provider === 'codex' && settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),")
replace('    .panel[hidden]{display:none}', '    .panel[hidden],#reasoning-field[hidden],#reasoning-hint[hidden]{display:none}')
# Windows 启动器只注册一次；日常从面板发起启动，再检测健康状态和获取模型。
replace('            <label class="field">API 地址', '''            <div class="settings-card" id="local-bridge" hidden>
              <b>本地桥接</b><p class="hint" id="bridge-status" role="status" aria-live="polite">点击检测连接，或启动本地桥接。</p>
              <div class="row"><button class="action secondary" id="start-bridge">启动本地桥接</button><button class="action secondary" id="check-bridge">检测连接</button></div>
              <p class="hint">首次使用：在项目目录运行 install-bridge-launcher.ps1 注册 Windows 启动器。以后可在这里启动；浏览器提示时允许打开。启动后自动获取模型，原连接密钥继续使用。</p>
            </div>
            <label class="field">API 地址''')
replace('#reasoning-hint[hidden]{display:none}', '#reasoning-hint[hidden],#local-bridge[hidden]{display:none}')
replace("    ui('reasoning-field').hidden = !isCodex;", "    ui('local-bridge').hidden = !isCodex;\n    ui('reasoning-field').hidden = !isCodex;")
replace("  function chooseProvider() {", Path('userscript/bridge-controls.js').read_text(encoding='utf-8') + '\n  function chooseProvider() {')
replace("    ui('get-models').onclick = fetchModels;", "    ui('get-models').onclick = fetchModels;\n    ui('start-bridge').onclick = startLocalBridge;\n    ui('check-bridge').onclick = () => checkLocalBridge();")
replace("    if (name) selectTab(name);", "    if (name) selectTab(name);\n    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();")
replace("    for (const view of all(shadow, '.view')) view.hidden = view.dataset.view !== name;", "    for (const view of all(shadow, '.view')) view.hidden = view.dataset.view !== name;\n    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();")
replace("    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();\n  }\n\n  function syncInputs", "  }\n\n  function syncInputs")
replace("本地 Codex：先启动 bridge.mjs，将终端显示的本地连接密钥填入 Key，获取模型后保存。", "本地 Codex：使用上方按钮启动桥接，填入本地连接密钥，获取模型后保存。首次使用需注册本地启动器。")
# Separate open-ended prose from blanks through detection, prompting, validation and writing.
replace("    if (/填空|简答|论述/.test(attr)) return 'blank';", "    if (/简答|论述|问答|解答|名词解释|分析题|计算题/.test(attr)) return 'essay';\n    if (/填空/.test(attr)) return 'blank';")
replace("      if (/填空|简答|论述/.test(marker)) return 'blank';", "      if (/简答|论述|问答|解答|名词解释|分析题|计算题/.test(marker)) return 'essay';\n      if (/填空/.test(marker)) return 'blank';")
replace("(多项选择题|单选题|多选题|判断题|填空题|简答题|论述题)\\s*[）)〗\\]】]", "(多项选择题|单选题|多选题|判断题|填空题|简答题|论述题|问答题|解答题|名词解释|分析题|计算题)(?=[\\s，,、；;）)〗\\]】])")
replace("    return 'blank';\n  }\n\n  function getOptionElements", "    // 无明确题型时，只把多答题区或题干中的空位当填空；一个编辑器可容纳多个论述要点。\n    const targets = blankTargets(container);\n    return targets.length > 1 || /_{2,}|＿{2,}|[（(]\\s*[）)]/.test(titleText) ? 'blank' : 'essay';\n  }\n\n  function getOptionElements")
replace("  const ANSWER_PROMPT_REVISION = 'accuracy-v2-context';", "  const ANSWER_PROMPT_REVISION = 'accuracy-v3-essay';")
replace("      blank: `填空或文本题：", "      essay: '简答、论述或开放文本题：answer 返回完整纯文本字符串，可按题目要求分段、分点、换行。一个答题编辑器可以容纳多个要点，编辑器数量不是要点数量；不能因为一个编辑器需要回答多个点就返回 needs_review。不要把要点拆成多个填空，不重复题干。不得输出图片、HTML 或 Markdown 图片。',\n      blank: `填空题：")
replace('；简答题按题目要求写完整必要内容。', '。')
replace("    if (typeof answer !== 'string') throw new Error('选择或判断答案必须是字符串');", "    if (item.type === 'essay') return essayValues(answer, 1)[0];\n    if (typeof answer !== 'string') throw new Error('选择或判断答案必须是字符串');")
replace("  function blankHTML(value) {", """  function essayValues(answer, count) {
    if (count !== 1) throw new Error('简答题存在多个独立答题区，请人工核对答题区对应关系');
    if (Array.isArray(answer) && answer.some(value => !['string', 'number'].includes(typeof value))) throw new Error('简答题答案必须是纯文本或要点数组');
    if (!Array.isArray(answer) && !['string', 'number'].includes(typeof answer)) throw new Error('简答题答案必须是纯文本');
    const value = Array.isArray(answer) ? answer.map(part => String(part).trim()).filter(Boolean).join('\\n') : String(answer).trim();
    // 包成单元素数组以保留正文中的竖线、公式和原有换行；复用纯文本安全检查。
    return blankValues([value], 1);
  }

  function blankHTML(value) {""")
replace("  async function fillBlanks(container, answer) {", "  async function fillBlanks(container, answer, type = 'blank') {")
replace("try { values = blankValues(answer, targets.length); }", "try { values = type === 'essay' ? essayValues(answer, targets.length) : blankValues(answer, targets.length); }")
replace("    if (item.type === 'blank') {\n      return fillBlanks(container, answer);", "    if (item.type === 'blank' || item.type === 'essay') {\n      return fillBlanks(container, answer, item.type);")
replace("item.type === 'blank' ? 8000 : 4500", "(item.type === 'blank' || item.type === 'essay') ? 8000 : 4500")
replace("blank: '填空' }[item.type]", "blank: '填空', essay: '简答/论述' }[item.type]")
replace("if (item.type !== 'blank') cacheAnswer(item, answer);", "if (!['blank', 'essay'].includes(item.type)) cacheAnswer(item, answer);")
replace("if (item.type === 'blank') cacheAnswer(item, answer);", "if (['blank', 'essay'].includes(item.type)) cacheAnswer(item, answer);")
# The current bank adapter only defines choice/judge/blank codes; do not query essays as single choice.
replace("items.filter(item => !item.unsupported && clean(item.title).length >= 5", "items.filter(item => item.type !== 'essay' && !item.unsupported && clean(item.title).length >= 5")
replace("    async function bankLookup(item) {\n      try {", "    async function bankLookup(item) {\n      if (item.type === 'essay') return '';\n      try {")
start = s.index('  function blankTargets(container) {')
end = s.index('  function blankValues(answer, count) {', start)
s = s[:start] + Path('userscript/blank-targets.js').read_text(encoding='utf-8') + '\n' + s[end:]
replace("          const backing = all(container, 'textarea').find(node => node.name === name || node.id === name);", """          const candidates = all(container, 'textarea').filter(node => node.name === name || node.id === name);
          const linked = (target.nodes || []).filter(node => node.matches('textarea'));
          const backing = linked.length === 1 ? linked[0] : candidates.length === 1 ? candidates[0] : null;
          if (!backing && (linked.length > 1 || candidates.length > 1)) throw new Error('无法唯一确认编辑器的提交字段');""")
replace("    let values;\n    try { values = type === 'essay'", """    if (type === 'essay' && targets.length > 1) {
      const details = targets.map(target => `${target.kind}:${target.node.id || target.node.getAttribute('name') || target.node.tagName}`).join(', ').slice(0, 240);
      return { ok: false, reason: `简答题检测到 ${targets.length} 个可编辑答题区（${details}），请核对编辑器识别结果` };
    }
    let values;
    try { values = type === 'essay'""")
Path('byj.user.js').write_text(s, encoding='utf-8')
print('已生成 byj.user.js')
