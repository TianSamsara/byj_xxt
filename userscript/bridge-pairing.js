  // This runs in the userscript sandbox on both sites. Never send keys through page
  // messages, URL parameters, opener, or an unauthenticated cross-origin API.
  const BRIDGE_PAIR_PENDING = 'xxt-assistant-bridge-pair-pending';
  const BRIDGE_PAIR_SETTINGS = 'xxt-assistant-settings';
  const BRIDGE_PAIR_ENDPOINT = 'http://127.0.0.1:17653/v1/chat/completions';
  let bridgePairPromise;
  function pairConnectionStamp(value) {
    return JSON.stringify([value.provider || '', value.endpoint || '', value.key || '']);
  }
  function validBridgePair(pending, id) {
    return pending && /^[a-f0-9]{64}$/.test(id) && pending.id === id &&
      Number.isFinite(pending.expires) && pending.expires > Date.now() && pending.expires <= Date.now() + 65000 &&
      pending.stamp === pairConnectionStamp(GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {});
  }
  function pairLocalRequest(path, key) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: 'GET', url: `http://127.0.0.1:17653${path}`, timeout: 10000,
      headers: { Authorization: `Bearer ${key}` },
      onload: response => {
        if (response.status !== 200 || (response.finalUrl && response.finalUrl !== `http://127.0.0.1:17653${path}`))
          return reject(new Error('本机桥接校验失败，请确认当前服务已启动后重新连接'));
        try { resolve(JSON.parse(response.responseText)); } catch { reject(new Error('本机桥接响应格式异常')); }
      },
      onerror: () => reject(new Error('本机桥接未连接，请先启动桥接')),
      ontimeout: () => reject(new Error('本机桥接验证超时，请重试')),
      onabort: () => reject(new Error('本机桥接验证已取消'))
    }));
  }
  async function handleBridgePairPage() {
    if (window !== window.top || location.origin !== 'http://127.0.0.1:17653' || location.pathname !== '/setup') return;
    const id = location.hash.slice(1);
    const status = document.getElementById('status');
    if (!validBridgePair(GM_getValue(BRIDGE_PAIR_PENDING), id)) return;
    try {
      if (status) status.textContent = '正在验证桥接并自动保存到学习通助手…';
      const key = document.getElementById('local-key')?.value || '';
      if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('本机密钥格式异常，请重启桥接后重试');
      const health = await pairLocalRequest('/health', key);
      if (health.service !== 'byj-codex-bridge') throw new Error('本机服务身份不匹配');
      let catalog;
      try { catalog = await pairLocalRequest('/v1/models', key); }
      catch (error) { if (!health.capabilities?.chatgpt_login) throw error; catalog = { data: [] }; }
      const rows = (Array.isArray(catalog.data) ? catalog.data : []).slice(0, 1000)
        .filter(row => row && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 120);
      if (!rows.length && !health.capabilities?.chatgpt_login) throw new Error('桥接没有可用模型，请确认 Codex 已登录后重试');
      if (!validBridgePair(GM_getValue(BRIDGE_PAIR_PENDING), id)) throw new Error('连接设置已改变或配对已过期，请返回重新连接');
      const saved = GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {};
      const keepModel = saved.provider === 'codex' && (!rows.length || rows.some(row => row.id === saved.model));
      GM_setValue(BRIDGE_PAIR_SETTINGS, { ...saved, provider: 'codex', endpoint: BRIDGE_PAIR_ENDPOINT,
        key, model: keepModel ? saved.model || '' : rows[0]?.id || '', reasoningEffort: keepModel ? saved.reasoningEffort || '' : '', localBridgeAutoPair: true });
      GM_setValue(BRIDGE_PAIR_PENDING, { id, expires: 0, done: true });
      if (status) status.textContent = '已自动保存当前密钥与连接设置。返回学习通即可使用，无需复制粘贴；此标签页可以关闭。';
      history.replaceState(null, '', '/setup');
    } catch (error) {
      if (GM_getValue(BRIDGE_PAIR_PENDING)?.id === id) GM_setValue(BRIDGE_PAIR_PENDING, { id, expires: 0, failed: true });
      if (status) status.textContent = `${error.message}。请返回学习通点击“自动连接并保存”重试。`;
    }
  }
  function requestBridgePair() {
    if (bridgePairPromise) return bridgePairPromise;
    bridgePairPromise = (async () => {
      const saved = GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {};
      let pending = GM_getValue(BRIDGE_PAIR_PENDING);
      if (!validBridgePair(pending, pending?.id || '')) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        pending = { id: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''),
          stamp: pairConnectionStamp(saved), expires: Date.now() + 60000 };
        GM_setValue(BRIDGE_PAIR_PENDING, pending);
        try { GM_openInTab(`http://127.0.0.1:17653/setup#${pending.id}`, { active: true, insert: true, setParent: false }); }
        catch { GM_setValue(BRIDGE_PAIR_PENDING, { id: pending.id, expires: 0, failed: true }); throw new Error('无法打开本机配对页，请允许油猴打开标签页'); }
      }
      while (Date.now() < pending.expires) {
        const state = GM_getValue(BRIDGE_PAIR_PENDING);
        if (state?.id !== pending.id || state.failed) throw new Error('本机配对未完成，请点击“自动连接并保存”重试');
        if (state.done) {
          const latest = GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {};
          if (latest.provider === 'codex' && latest.endpoint === BRIDGE_PAIR_ENDPOINT && /^[a-f0-9]{64}$/.test(latest.key)) return latest;
          throw new Error('连接设置已改变，请重新连接');
        }
        if (pairConnectionStamp(GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {}) !== pending.stamp) throw new Error('连接设置已改变，已取消自动保存');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      throw new Error('自动配对超时。请更新油猴脚本并允许在本机 /setup 页面运行，再点击“自动连接并保存”');
    })().finally(() => { bridgePairPromise = null; });
    return bridgePairPromise;
  }
  async function recoverLocalBridgeKey(connection) {
    if (!connection.localBridgeAutoPair || connection.provider !== 'codex' || connection.endpoint !== BRIDGE_PAIR_ENDPOINT) return false;
    const saved = GM_getValue(BRIDGE_PAIR_SETTINGS, {}) || {};
    if (!saved.localBridgeAutoPair || saved.provider !== 'codex' || saved.endpoint !== BRIDGE_PAIR_ENDPOINT) return false;
    if (saved.key !== connection.key) return true;
    const attempt = GM_getValue(BRIDGE_PAIR_PENDING);
    if (attempt?.failedAt && Date.now() - attempt.failedAt < 60000) throw new Error('自动配对暂未成功，请允许油猴在本机页面运行，或点击“自动连接并保存”重试');
    try { await requestBridgePair(); }
    catch (error) {
      const state = GM_getValue(BRIDGE_PAIR_PENDING);
      if (!state?.done) GM_setValue(BRIDGE_PAIR_PENDING, { ...state, expires: 0, failed: true, failedAt: Date.now() });
      throw error;
    }
    return true;
  }
  if (location.origin === 'http://127.0.0.1:17653') {
    void handleBridgePairPage();
    return;
  }
