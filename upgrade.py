from pathlib import Path

source = Path('upstream.user.js').read_text(encoding='utf-8')
s = source
def replace(old, new):
    global s
    if old not in s:
        raise RuntimeError('源码不匹配: ' + old[:90])
    s = s.replace(old, new)

replace('// @namespace    https://github.com/local/xxt-assistant', '// @namespace    https://github.com/TianSamsara/byj_xxt')
replace('// @version      0.13.2', '// @version      0.15.0')
replace('// @description  学习通页面内控制面板：', '// @description  支持本地 Codex 登录、模型与思考强度选择；学习通页面内控制面板：')
# Only this repository supplies updates; the upstream Greasy Fork copy remains unchanged.
s = '\n'.join(line for line in s.split('\n') if not line.startswith(('// @downloadURL', '// @updateURL')))
replace('// @license      MIT', '''// @license      MIT
// @homepageURL  https://github.com/TianSamsara/byj_xxt
// @supportURL   https://github.com/TianSamsara/byj_xxt/issues
// @updateURL    https://raw.githubusercontent.com/TianSamsara/byj_xxt/main/byj.meta.js
// @downloadURL  https://raw.githubusercontent.com/TianSamsara/byj_xxt/main/byj.user.js''')
replace('// @grant        unsafeWindow', '// @grant        GM_info\n// @grant        GM_download\n// @grant        GM_setClipboard\n// @grant        GM_openInTab\n// @grant        unsafeWindow')
replace('  const providers = {', "  const providers = {\n    codex: { label: '本地 Codex（ChatGPT 登录）', endpoint: 'http://127.0.0.1:17653/v1/chat/completions', model: '', models: [] },")
replace('<option value="openai">', '<option value="codex">本地 Codex（ChatGPT 登录）</option><option value="openai">')
replace('>API Key<input', '>API Key / 本地连接密钥<input')
replace('Key 保存在油猴本地存储；', '本地 Codex：先启动 bridge.mjs，将终端显示的本地连接密钥填入 Key，获取模型后保存。仅打开 Codex 窗口还不够；需要本机 Codex CLI 的 ChatGPT 登录状态。本地密钥不是 OpenAI API Key。Key 保存在油猴本地存储；')
replace("    const url = validateEndpoint(settings.endpoint);\n    const wantImages", "    const url = validateProviderEndpoint(settings.endpoint, settings.provider);\n    const wantImages")
replace("        timeout: 60000,", "        timeout: settings.provider === 'codex' ? 190000 : 60000,")
replace("    const url = modelsURL(endpoint, provider);", "    validateProviderEndpoint(endpoint, provider);\n    const url = modelsURL(endpoint, provider);")
replace("    log(`已选择 ${preset.label}，请填写该服务商的 API Key`);", "    log(ui('provider').value === 'codex' ? '启动桥接后点击复制本地密钥；密钥为空时在本机密钥页复制，再返回粘贴并获取模型' : `已选择 ${preset.label}，请填写该服务商的 API Key`);")
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
replace("model: providers.deepseek.model, key: '', delay: 1200,", "model: providers.deepseek.model, key: '', reasoningEffort: '', codexWebSearch: true, delay: 1200,")
replace('            <div class="row"><button class="action secondary" id="get-models">', '''            <label class="field" id="reasoning-field" hidden>思考强度<select class="field" id="reasoning-effort" aria-label="选择思考强度"></select></label>
            <p class="hint" id="reasoning-hint" hidden></p>
            <div id="web-search-field" hidden><label class="check"><input type="checkbox" id="codex-web-search">允许联网检索（本地 Codex）</label>
              <p class="hint">默认开启，AI 按需查询公开网页，题目相关搜索词会发往搜索服务。要求来源的题目会在正文保留链接；可能增加等待时间和额度消耗。更改后保存设置，桥接需 0.14.7+。</p></div>
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
    ui('web-search-field').hidden = !isCodex;
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
    ui('reasoning-hint').textContent = !options.length ? '请重新获取模型以加载支持的思考档位；未提供档位时使用模型默认。' : '常规题可选低（low）以缩短等待；较高强度通常需要更长等待并消耗更多额度。档位由本机 Codex 返回，更改后点击保存设置。';
  }

  function chooseProvider() {""")
replace("    if (!preset) return;\n    ui('endpoint')", "    if (!preset) { renderReasoningOptions(''); return; }\n    ui('endpoint')")
replace("    ui('provider').onchange = chooseProvider;", "    ui('provider').onchange = chooseProvider;\n    ui('model').onchange = () => renderReasoningOptions('');")
replace("    settings = { ...settings, endpoint, model, key,", "    settings = { ...settings, endpoint, model, key,\n      reasoningEffort: ui('provider').value === 'codex' ? ui('reasoning-effort').value : '',")
replace("      reasoningEffort: ui('provider').value", "      codexWebSearch: ui('codex-web-search').checked,\n      reasoningEffort: ui('provider').value")
replace("    syncAnswerInputs();\n    renderModelOptions", "    syncAnswerInputs();\n    ui('codex-web-search').checked = settings.codexWebSearch === true;\n    renderModelOptions")
replace("        data: JSON.stringify({ model: settings.model,", "        data: JSON.stringify({ model: settings.model,\n          ...(settings.provider === 'codex' && settings.reasoningEffort ? { reasoning_effort: settings.reasoningEffort } : {}),")
replace("          ...(settings.provider === 'codex' && settings.reasoningEffort", "          ...(settings.provider === 'codex' ? { web_search: settings.codexWebSearch === true } : {}),\n          ...(settings.provider === 'codex' && settings.reasoningEffort")
replace("  async function askAI(item) {", Path('userscript/web-search.js').read_text(encoding='utf-8') + '\n  async function askAI(item) {')
replace("    const wantImages = Boolean(answerConfig()", "    if (settings.provider === 'codex' && settings.codexWebSearch === true) await ensureLocalWebSearch(url, settings.key);\n    const wantImages = Boolean(answerConfig()")
replace("            if (body.choices?.[0]?.finish_reason", "            if (body.web_search?.requests > 0) log(`本题 Codex 发起 ${body.web_search.requests} 次网页检索/查阅，请核对答案中的来源。`);\n            if (body.choices?.[0]?.finish_reason")
replace("            if (body.web_search?.requests > 0)", "            if (connection.provider === 'codex' && body.bridge_timing) {\n              const timing = body.bridge_timing;\n              log(`本题 Codex 用时 ${(timing.total_ms / 1000).toFixed(1)} 秒：准备 ${(Math.max(0, timing.total_ms - timing.inference_ms) / 1000).toFixed(1)} 秒，模型/检索 ${(timing.inference_ms / 1000).toFixed(1)} 秒${timing.reused_process ? '（复用连接）' : '（首次启动）'}`);\n            }\n            if (body.web_search?.requests > 0)")
replace('    .panel[hidden]{display:none}', '    .panel[hidden],#reasoning-field[hidden],#reasoning-hint[hidden],#web-search-field[hidden]{display:none}')
# Windows 启动器只注册一次；日常从面板发起启动，再检测健康状态和获取模型。
replace('            <label class="field">API 地址', '''            <div class="settings-card" id="local-bridge" hidden>
              <b>本地桥接</b><p class="hint" id="bridge-status" role="status" aria-live="polite">首次使用先安装一次，以后直接启动。</p>
              <button class="action" id="install-bridge">安装／修复本地桥接</button>
              <div class="row"><button class="action secondary" id="start-bridge">启动本地桥接</button><button class="action secondary" id="check-bridge">检测连接</button></div>
              <p class="hint">新电脑：先打开 Codex 并登录，点击上方安装按钮，解压下载包并双击其中的安装文件一次。自动准备桥接和运行组件，不用下载完整项目或手动注册。以后点击启动；密钥复制失败可用下方“复制本地密钥”。</p>
            </div>
            <label class="field">API 地址''')
replace('            <label class="field">模型<select', '''            <div class="row" id="copy-key-row" hidden><button class="action secondary" id="copy-local-key">复制本地密钥</button></div>
            <label class="field">模型<select''')
replace('#web-search-field[hidden]{display:none}', '#web-search-field[hidden],#local-bridge[hidden],#copy-key-row[hidden]{display:none}')
replace("    ui('reasoning-field').hidden = !isCodex;", "    ui('local-bridge').hidden = !isCodex;\n    ui('copy-key-row').hidden = !isCodex;\n    ui('reasoning-field').hidden = !isCodex;")
replace("  function chooseProvider() {", Path('userscript/bridge-controls.js').read_text(encoding='utf-8') + '\n  function chooseProvider() {')
replace("    ui('get-models').onclick = fetchModels;", "    ui('get-models').onclick = fetchModels;\n    ui('start-bridge').onclick = startLocalBridge;\n    ui('install-bridge').onclick = installLocalBridge;\n    ui('copy-local-key').onclick = copyLocalBridgeKey;\n    ui('check-bridge').onclick = () => checkLocalBridge();")
replace("    if (name) selectTab(name);", "    if (name) selectTab(name);\n    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();")
replace("    for (const view of all(shadow, '.view')) view.hidden = view.dataset.view !== name;", "    for (const view of all(shadow, '.view')) view.hidden = view.dataset.view !== name;\n    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();")
replace("    if (name === 'settings' && ui('provider').value === 'codex') void checkLocalBridge();\n  }\n\n  function syncInputs", "  }\n\n  function syncInputs")
replace("本地 Codex：先启动 bridge.mjs，将终端显示的本地连接密钥填入 Key，获取模型后保存。", "本地 Codex：新电脑先点击安装／修复本地桥接，双击安装文件一次。密钥为空时点击复制按钮打开本机密钥页；已有密钥时由油猴直接复制。粘贴、获取模型后保存。")
# Separate open-ended prose from blanks through detection, prompting, validation and writing.
replace("    if (/填空|简答|论述/.test(attr)) return 'blank';", "    if (/简答|论述|问答|解答|名词解释|分析题|计算题/.test(attr)) return 'essay';\n    if (/填空/.test(attr)) return 'blank';")
replace("      if (/填空|简答|论述/.test(marker)) return 'blank';", "      if (/简答|论述|问答|解答|名词解释|分析题|计算题/.test(marker)) return 'essay';\n      if (/填空/.test(marker)) return 'blank';")
replace("(多项选择题|单选题|多选题|判断题|填空题|简答题|论述题)\\s*[）)〗\\]】]", "(多项选择题|单选题|多选题|判断题|填空题|简答题|论述题|问答题|解答题|名词解释|分析题|计算题)(?=[\\s，,、；;）)〗\\]】])")
replace("    return 'blank';\n  }\n\n  function getOptionElements", "    // 无明确题型时，只把多答题区或题干中的空位当填空；一个编辑器可容纳多个论述要点。\n    const targets = blankTargets(container);\n    return targets.length > 1 || /_{2,}|＿{2,}|[（(]\\s*[）)]/.test(titleText) ? 'blank' : 'essay';\n  }\n\n  function getOptionElements")
replace("  const ANSWER_PROMPT_REVISION = 'accuracy-v2-context';", "  const ANSWER_PROMPT_REVISION = 'accuracy-v4-web-search';")
replace("  function buildAnswerPrompt(item, imageCount) {", "  function buildAnswerPrompt(item, imageCount, connection = settings) {")
replace("    return `请解答下面这一道题。", """    const searchRule = connection.provider === 'codex' ? (connection.codexWebSearch === true
      ? '本次允许使用内置网页搜索，但普通且稳定的知识题直接作答，不为增加来源而检索。题目明确要求上网检索、对比来源或信息需要查证时，先实际检索和查阅资料，再完成答案；按题目要求的来源数量核对，资料充分后及时作答，避免重复查询。简答/论述题在 answer 正文列出来源标题与完整 https 链接；选择、判断和填空题的 answer 必须严格保持题型规定的格式，来源可另列于顶层 sources 数组，不能附在选项字母或填空内容中。不要把检索进度写入 JSON，不要用内部引用标记代替链接。'
      : '本次网页搜索已关闭。普通知识题可依已有知识回答，不要自行附加上网检索或至少两个来源的要求；题目明确要求实际检索且资料不足时，返回 needs_review 并提示开启 AI 连接中的联网检索。')
      : '是否可检索取决于当前服务商实际能力；不要声称执行过未发生的搜索。';
    return `请解答下面这一道题。\\n${searchRule}""")
replace("只输出一个 JSON 对象，不使用 Markdown 代码块", "仅在题目明确要求时满足指定来源数量，不要给普通知识题自行增加检索要求；不得编造来源或检索经历。只输出一个 JSON 对象，不使用 Markdown 代码块")
replace("${ANSWER_PROMPT_REVISION}:${JSON.stringify(item.context", "${ANSWER_PROMPT_REVISION}:${settings.provider === 'codex' && settings.codexWebSearch === true ? 'web' : 'no-web'}:${JSON.stringify(item.context")
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
replace('  async function fillBlanks(container, answer, type = \'blank\') {', Path('userscript/editor-verification.js').read_text(encoding='utf-8') + '\n  async function fillBlanks(container, answer, type = \'blank\') {')
replace("          editor.sync();\n          await sleep(100);\n          const actual = typeof editor.getContentTxt === 'function' ? editor.getContentTxt() : editor.body?.textContent;\n          if (actual == null || clean(actual) !== clean(value)) throw new Error('编辑器内容未确认');\n", '')
replace("          const backing = all(container, 'textarea').find(node => node.name === name || node.id === name);", """          const candidates = all(container, 'textarea').filter(node => node.name === name || node.id === name);
          const linked = (target.nodes || []).filter(node => node.matches('textarea'));
          const backing = linked.length === 1 ? linked[0] : candidates.length === 1 ? candidates[0] : null;
          if (!backing && (linked.length > 1 || candidates.length > 1)) throw new Error('无法唯一确认编辑器的提交字段');""")
replace("""          if (backing) {
            const markup = container.ownerDocument.createElement('template');
            markup.innerHTML = backing.value;
            if (clean(backing.value) !== clean(value) && clean(markup.content.textContent) !== clean(value))
              throw new Error('编辑区已写入，但提交字段未同步');
          }""", """          const expected = answerTextComparable(value);
          let verificationError = '';
          for (let attempt = 0; attempt < 10; attempt++) {
            if (!container.isConnected) throw new Error('题目已变化，无法确认写入结果');
            editor.sync();
            await sleep(100);
            const actual = readEditorAnswer(editor, container.ownerDocument);
            if (actual == null || answerTextComparable(actual) !== expected) {
              verificationError = `编辑器正文读取不一致（期望 ${expected.length} 字符，读到 ${actual == null ? '不可读' : answerTextComparable(actual).length} 字符），请核对是否被截断或改写`;
              continue;
            }
            if (backing && answerTextComparable(backing.value) !== expected &&
                answerTextComparable(editorHTMLText(backing.value, container.ownerDocument)) !== expected) {
              verificationError = '编辑区已写入，但提交字段未同步，请暂勿提交';
              continue;
            }
            verificationError = ''; break;
          }
          if (verificationError) throw new Error(verificationError);""")
replace("      } catch (error) { return `第 ${index + 1} 空：${error.message}`; }", "      } catch (error) { return type === 'essay' ? `简答题：${error.message}` : `第 ${index + 1} 空：${error.message}`; }")
replace("    let values;\n    try { values = type === 'essay'", """    if (type === 'essay' && targets.length > 1) {
      const details = targets.map(target => `${target.kind}:${target.node.id || target.node.getAttribute('name') || target.node.tagName}`).join(', ').slice(0, 240);
      return { ok: false, reason: `简答题检测到 ${targets.length} 个可编辑答题区（${details}），请核对编辑器识别结果` };
    }
    let values;
    try { values = type === 'essay'""")
# Keep one request's endpoint, credentials, model and search policy together across awaits.
ask_start = s.index('  async function askAI(item) {')
ask_end = s.index('  function cacheKey(item)', ask_start)
ask_source = s[ask_start:ask_end].replace('settings.', 'connection.')
ask_source = ask_source.replace('  async function askAI(item) {', '  async function askAI(item) {\n    const connection = { ...settings };')
ask_source = ask_source.replace('buildAnswerPrompt(item, images.length)', 'buildAnswerPrompt(item, images.length, connection)')
s = s[:ask_start] + ask_source + s[ask_end:]
Path('byj.user.js').write_text(s, encoding='utf-8')
metadata_end = s.index('// ==/UserScript==') + len('// ==/UserScript==')
Path('byj.meta.js').write_text(s[:metadata_end] + '\n', encoding='utf-8')
print('已生成 byj.user.js 和 byj.meta.js')
