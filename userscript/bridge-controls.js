  let bridgeCheckGeneration = 0;
  let bridgeStarting = false;
  const embeddedBridgeInstaller = '__BYJ_INSTALLER_ZIP_BASE64__';
  let bridgeInstallerURL = '';
  let verifiedLocalBridgeKey = '';
  let verifiedLocalBridgeKeyUntil = 0;

  function verifyLocalBridgeKey(key, accepted) {
    if (ui('provider').value !== 'codex' || ui('endpoint').value.trim() !== providers.codex.endpoint || ui('key').value.trim() !== key) return;
    verifiedLocalBridgeKey = accepted ? key : '';
    verifiedLocalBridgeKeyUntil = accepted ? Date.now() + 30000 : 0;
  }

  function localBridgeAuthError(error, key) {
    if (error?.status !== 401 || ui('provider').value !== 'codex' || ui('endpoint').value.trim() !== providers.codex.endpoint || ui('key').value.trim() !== key) return false;
    verifyLocalBridgeKey(key, false);
    const message = '桥接已运行，但当前密钥不匹配。点击“获取当前密钥”，在本机页面复制后替换 Key，重新获取模型并保存设置。';
    ui('bridge-status').textContent = message; log(message); return true;
  }

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
    verifyLocalBridgeKey(key, state === 'ready');
    const messages = {
      ready: '桥接已连接', unauthorized: '桥接已运行，请使用正确的本地连接密钥；点击“获取当前密钥”，在本机页面复制后替换 Key，重新获取模型并保存设置',
      incompatible: '检测到旧版桥接或其他服务，请先停止旧服务并启动新版桥接',
      offline: wait ? '未连接。新电脑请先点击“安装／修复本地桥接”，解压下载包后双击安装一次；已安装时请允许浏览器打开启动器。' : '桥接未连接。首次使用先安装本地桥接，安装过则点击“启动本地桥接”。'
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
    if (!key || key !== verifiedLocalBridgeKey || Date.now() >= verifiedLocalBridgeKeyUntil) { openLocalKeyPage(); return; }
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
      log('已请求启动本地桥接。新电脑需先点击“安装／修复本地桥接”，解压下载包并双击安装文件；已安装时允许浏览器打开启动器');
      void checkLocalBridge(true, true).catch(() => {
        log('连接检测失败，可稍后点击“检测连接”重试');
      }).finally(() => { bridgeStarting = false; ui('start-bridge').disabled = false; });
    } catch {
      bridgeStarting = false; ui('start-bridge').disabled = false;
      ui('bridge-status').textContent = '无法打开启动器。请点击“安装／修复本地桥接”，解压下载包并双击安装文件后再试。';
    }
  }

  function installLocalBridge() {
    if (ui('provider').value !== 'codex') return;
    const button = ui('install-bridge');
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (!bridgeInstallerURL) {
        const bytes = Uint8Array.from(atob(embeddedBridgeInstaller), char => char.charCodeAt(0));
        if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4)
          throw new Error('安装包内容不完整，请重新更新油猴脚本');
        bridgeInstallerURL = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      }
      const link = ui('installer-save');
      link.href = bridgeInstallerURL;
      link.download = 'install-byj-bridge.zip';
      link.hidden = false;
      // Keep the click synchronous with the user's action. The visible link remains usable
      // if a browser blocks programmatic downloads; one small Blob is reused for this page.
      link.click();
      const message = '已发起安装包保存。若没有出现下载，请点下方“直接保存安装包”。保存后解压并双击其中的 install-byj-bridge.cmd 一次；完成后返回粘贴密钥、获取模型并保存。';
      ui('bridge-status').textContent = message; log(message);
    } catch (error) {
      const detail = error?.name === 'InvalidCharacterError' ? '内置安装包内容异常，请重新更新脚本' : error?.message === '安装包内容不完整，请重新更新油猴脚本' ? error.message : '浏览器未能创建本地下载文件';
      const message = `无法准备安装包：${detail}。请点“GitHub 备用下载”，或使用项目页面的 install-byj-bridge.zip。`;
      ui('bridge-status').textContent = message; log(message);
    } finally { button.disabled = false; }
  }
