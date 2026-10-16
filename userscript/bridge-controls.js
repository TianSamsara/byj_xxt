  let bridgeCheckGeneration = 0;
  let bridgeStarting = false;

  function probeLocalBridge(key) {
    return new Promise(resolve => {
      GM_xmlhttpRequest({
        method: 'GET', url: 'http://127.0.0.1:17653/health', timeout: 2000,
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        onload: response => {
          if (response.status === 401) return resolve('unauthorized');
          try {
            const data = JSON.parse(response.responseText);
            resolve(response.status === 200 && data.service === 'byj-codex-bridge' ? 'ready' : 'incompatible');
          } catch { resolve('incompatible'); }
        },
        onerror: () => resolve('offline'), ontimeout: () => resolve('offline'), onabort: () => resolve('offline')
      });
    });
  }

  async function checkLocalBridge(wait = false, loadModels = false) {
    const generation = ++bridgeCheckGeneration;
    const key = ui('key').value.trim();
    const current = () => generation === bridgeCheckGeneration && ui('provider').value === 'codex' &&
      ui('endpoint').value.trim() === providers.codex.endpoint && ui('key').value.trim() === key;
    if (!current()) return;
    ui('bridge-status').textContent = wait ? '等待本地启动器启动桥接…' : '正在检测桥接…';
    const deadline = Date.now() + (wait ? 30000 : 0);
    let state;
    do {
      state = await probeLocalBridge(key);
      if (!current()) return;
      if (state !== 'offline' || Date.now() >= deadline) break;
      await sleep(1000);
    } while (current());
    if (!current()) return;
    const messages = {
      ready: '桥接已连接', unauthorized: '桥接已运行，请填写正确的本地连接密钥；点击“复制本地密钥”打开本机密钥页，复制后按 Ctrl+V 粘贴',
      incompatible: '检测到旧版桥接或其他服务，请先停止旧服务并启动新版桥接',
      offline: wait ? '未连接。请允许浏览器打开本地启动器；首次使用需先运行 install-bridge-launcher.ps1。' : '桥接未连接，可点击“启动本地桥接”。'
    };
    ui('bridge-status').textContent = messages[state];
    if (wait) log(messages[state]);
    if (state === 'ready' && loadModels && !ui('get-models').disabled) await fetchModels();
    return state;
  }

  function openLocalKeyPage() {
    if (ui('provider').value !== 'codex') return;
    try {
      GM_openInTab('http://127.0.0.1:17653/setup', { active: true, insert: true, setParent: false });
      log('已打开本机密钥页，请在新标签页点击复制，再返回这里粘贴；页面打不开时请先启动桥接');
    } catch {
      log('无法打开本机密钥页，请在浏览器打开 http://127.0.0.1:17653/setup；需要新版桥接正在运行');
    }
  }

  function copyLocalBridgeKey() {
    if (ui('provider').value !== 'codex' || ui('endpoint').value.trim() !== providers.codex.endpoint) return;
    const key = ui('key').value.trim();
    if (!key) { openLocalKeyPage(); return; }
    const button = ui('copy-local-key');
    if (button.disabled) return;
    button.disabled = true;
    const timer = setTimeout(() => {
      button.disabled = false;
      log('未收到剪贴板写入确认，请使用本机密钥页复制');
      openLocalKeyPage();
    }, 3000);
    try {
      GM_setClipboard(key, { type: 'text', mimetype: 'text/plain' }, () => {
        clearTimeout(timer); button.disabled = false;
        log('本地连接密钥已复制到剪贴板');
        toast('本地连接密钥已复制');
      });
    } catch {
      clearTimeout(timer); button.disabled = false;
      log('油猴剪贴板接口不可用，已切换到本机密钥页');
      openLocalKeyPage();
    }
  }

  function startLocalBridge() {
    if (bridgeStarting || ui('provider').value !== 'codex') return;
    bridgeStarting = true;
    ui('start-bridge').disabled = true;
    // 必须在用户点击的同步调用中触发协议；URI 不含密钥、参数或可执行命令。
    try {
      const link = document.createElement('a');
      link.href = 'byj-codex://start';
      document.documentElement.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      log('已请求启动本地桥接；如未弹出启动器或没有复制成功，请点击“复制本地密钥”使用本机密钥页');
      void checkLocalBridge(true, true).catch(() => {
        log('连接检测失败，可稍后点击“检测连接”重试');
      }).finally(() => { bridgeStarting = false; ui('start-bridge').disabled = false; });
    } catch {
      bridgeStarting = false; ui('start-bridge').disabled = false;
      ui('bridge-status').textContent = '无法打开本地启动器，请先运行 install-bridge-launcher.ps1 或手动运行 start-bridge.ps1。';
    }
  }
