  function ensureLocalWebSearch(endpoint, key) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url: new URL('/health', endpoint).href,
        headers: { Authorization: `Bearer ${key}` }, timeout: 5000,
        onload: response => {
          if (response.status !== 200) return reject(new Error('联网检索检查失败，请检测桥接连接和密钥'));
          try {
            const health = JSON.parse(response.responseText);
            if (health.service !== 'byj-codex-bridge' || health.capabilities?.web_search !== true)
              throw new Error('当前桥接不支持联网检索，请更新本地项目并重启桥接（需 0.14.7+）；也可关闭联网检索');
            resolve();
          } catch (error) { reject(error); }
        },
        onerror: () => reject(new Error('本地桥接未连接，请先启动桥接')),
        ontimeout: () => reject(new Error('联网检索能力检查超时，请检测桥接连接'))
      });
    });
  }
