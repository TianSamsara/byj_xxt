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
      ready: '桥接已连接', unauthorized: '桥接已运行，请填写正确的本地连接密钥；可点击“复制本地密钥”，允许打开启动器后按 Ctrl+V 粘贴',
      incompatible: '检测到旧版桥接或其他服务，请先停止旧服务并启动新版桥接',
      offline: wait ? '未连接。请允许浏览器打开本地启动器；首次使用需先运行 install-bridge-launcher.ps1。' : '桥接未连接，可点击“启动本地桥接”。'
    };
    ui('bridge-status').textContent = messages[state];
    if (wait) log(messages[state]);
    if (state === 'ready' && loadModels && !ui('get-models').disabled) await fetchModels();
    return state;
  }

  function startLocalBridge() {
    if (bridgeStarting || ui('provider').value !== 'codex') return;
    bridgeStarting = true;
    ui('start-bridge').disabled = true;
    ui('copy-local-key').disabled = true;
    // 必须在用户点击的同步调用中触发协议；URI 不含密钥、参数或可执行命令。
    try {
      const link = document.createElement('a');
      link.href = 'byj-codex://start';
      document.documentElement.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      log('已请求本地启动器启动桥接并复制密钥；如浏览器询问，请允许打开，完成后在密钥框按 Ctrl+V 粘贴');
      void checkLocalBridge(true, true).catch(() => {
        log('连接检测失败，可稍后点击“检测连接”重试');
      }).finally(() => { bridgeStarting = false; ui('start-bridge').disabled = false; ui('copy-local-key').disabled = false; });
    } catch {
      bridgeStarting = false; ui('start-bridge').disabled = false; ui('copy-local-key').disabled = false;
      ui('bridge-status').textContent = '无法打开本地启动器，请先运行 install-bridge-launcher.ps1 或手动运行 start-bridge.ps1。';
    }
  }
