  function ensureLocalWebSearch(endpoint, key) {
    const cached = ensureLocalWebSearch.cached;
    if (cached?.endpoint === endpoint && cached.key === key && cached.expires > Date.now()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: new URL('/health', endpoint).href,
        headers: { Authorization: `Bearer ${key}` }, timeout: 5000,
        onload: response => {
          if (response.status !== 200) {
            ensureLocalWebSearch.cached = null;
            const message = response.status === 401
              ? '本地桥接拒绝已保存的密钥（HTTP 401）。请在 AI 连接获取当前密钥，替换 Key 后获取模型并保存设置，再重新开始作答'
              : `本地桥接能力检查返回 HTTP ${response.status}，请检测桥接连接后重试`;
            const error = new Error(message); error.status = response.status; return reject(error);
          }
          try {
            const health = JSON.parse(response.responseText);
            if (health.service !== 'byj-codex-bridge' || health.capabilities?.web_search !== true)
              throw new Error('当前桥接不支持联网检索，请更新本地项目并重启桥接（需 0.14.7+）；也可关闭联网检索');
            ensureLocalWebSearch.cached = { endpoint, key, expires: Date.now() + 15000 };
            resolve();
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('本地桥接未连接，请先启动桥接')),
        ontimeout: () => reject(new Error('联网检索能力检查超时，请检测桥接连接')),
        onabort: () => reject(new Error('本地桥接能力检查已取消，请检测连接后重试'))
      });
    });
  }
