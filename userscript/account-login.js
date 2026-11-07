  let accountRequestGeneration = 0;
  let accountPollTimer;
  let accountPendingId = '';
  let accountPollUntil = 0;

  function accountConnection() {
    if (ui('provider').value !== 'codex' || ui('endpoint').value.trim() !== providers.codex.endpoint)
      throw new Error('请先选择本地 Codex 连接');
    const key = ui('key').value.trim();
    if (!key) throw new Error('请先启动桥接并点击“自动连接并保存”，再登录 ChatGPT');
    return { key, current: () => ui('provider').value === 'codex' && ui('endpoint').value.trim() === providers.codex.endpoint && ui('key').value.trim() === key };
  }
  function accountRequest(path, connection, data) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method: data ? 'POST' : 'GET', url: `http://127.0.0.1:17653${path}`, timeout: 27000,
      headers: { Authorization: `Bearer ${connection.key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { data: JSON.stringify(data) } : {}),
      onload: response => {
        if (response.finalUrl && response.finalUrl !== `http://127.0.0.1:17653${path}`) return reject(new Error('登录接口发生异常跳转，已停止'));
        if (response.status !== 200) {
          const message = response.status === 401 ? '桥接密钥已失效，请先点击“自动连接并保存”再登录'
            : response.status === 404 ? '当前桥接不支持面板登录，请安装／修复到 0.16.0 后再试'
            : response.status === 409 ? '桥接正忙，请暂停作答或稍后刷新登录状态'
            : '登录接口未成功响应，请更新 Codex 和桥接后重试；设备码授权需在 ChatGPT 安全设置开启';
          const error = new Error(message); error.status = response.status; return reject(error);
        }
        try { resolve(JSON.parse(response.responseText)); } catch { reject(new Error('登录状态响应格式错误')); }
      },
      onerror: () => reject(new Error('本地桥接未连接，请先启动桥接')),
      ontimeout: () => reject(new Error('登录状态检查超时，请稍后刷新，不要重复发起授权')),
      onabort: () => reject(new Error('登录状态检查已取消'))
    }));
  }
  function renderAccountState(state) {
    const login = state?.login || {};
    const pending = login.status === 'pending';
    const waiting = pending || login.status === 'verifying';
    const signedIn = state?.account?.type === 'chatgpt' && !waiting;
    let message = signedIn ? `ChatGPT 已登录${state.account.planType ? `（${String(state.account.planType).slice(0, 40)}）` : ''}`
      : state?.account ? '当前使用其他登录方式；完成 ChatGPT 授权将更新本机 Codex 登录'
      : '尚未使用 ChatGPT 登录';
    if (pending) message = login.flow === 'device' ? '等待设备码授权：在官方页面登录并输入下方验证码' : '等待官方页面完成登录，授权后这里会自动更新';
    else if (login.status === 'verifying') message = '授权已返回，正在确认 ChatGPT 登录状态…';
    else if (!signedIn && ['failed', 'expired', 'cancelled'].includes(login.status)) message = ({ failed: '本次授权未完成，可重新登录或切换授权方式', expired: '本次授权已过期，请重新登录', cancelled: '已取消本次授权' })[login.status];
    ui('account-status').textContent = message;
    ui('account-login').disabled = signedIn || waiting;
    ui('account-flow').disabled = waiting;
    ui('account-cancel').hidden = !pending;
    ui('account-code').hidden = !(pending && login.flow === 'device');
    ui('account-code').textContent = pending && login.flow === 'device' && /^[A-Za-z0-9-]{4,32}$/.test(login.userCode || '') ? login.userCode : '';
    const link = ui('account-open');
    link.hidden = true; link.removeAttribute('href');
    if (pending) {
      try {
        const url = new URL(login.url);
        if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname) || url.username || url.password || (url.port && url.port !== '443') || url.hash) throw new Error('Invalid URL');
        link.href = url.href; link.hidden = false;
      } catch { ui('account-status').textContent = '授权地址校验失败，请取消后重新登录'; }
    }
    accountPendingId = pending && typeof login.loginId === 'string' ? login.loginId : '';
    return { pending: pending || login.status === 'verifying', signedIn };
  }
  async function updateAccountLogin(action = 'status') {
    const generation = ++accountRequestGeneration;
    clearTimeout(accountPollTimer);
    let connection;
    try { connection = accountConnection(); }
    catch (error) { ui('account-status').textContent = error.message; return; }
    const current = () => generation === accountRequestGeneration && connection.current();
    const loginId = accountPendingId;
    ui('account-status').textContent = action === 'login' ? '正在发起官方授权…' : action === 'cancel' ? '正在取消本次授权…' : '正在检查登录状态…';
    ui('account-login').disabled = true; ui('account-refresh').disabled = true; ui('account-cancel').disabled = true;
    try {
      const path = action === 'login' ? '/auth/login' : action === 'cancel' ? '/auth/cancel' : '/auth/status';
      const state = await accountRequest(path, connection, action === 'login' ? { flow: ui('account-flow').value } : action === 'cancel' ? { loginId } : null);
      if (!current()) return;
      const rendered = renderAccountState(state);
      if (action === 'login' && rendered.pending && !ui('account-open').hidden) {
        try { GM_openInTab(ui('account-open').href, { active: true, insert: true, setParent: false }); }
        catch { ui('account-status').textContent = '请点击“打开官方授权页”继续登录'; }
      }
      if (rendered.pending) {
        if (action === 'login' || !accountPollUntil) accountPollUntil = Date.now() + 610000;
        if (Date.now() < accountPollUntil) accountPollTimer = setTimeout(() => { if (current()) void updateAccountLogin(); }, 2000);
        else ui('account-status').textContent = '自动检查已结束，请点击“刷新登录状态”确认结果';
      } else {
        accountPollUntil = 0;
        if (rendered.signedIn && (action === 'login' || state.login?.status === 'succeeded') && !ui('get-models').disabled) await fetchModels();
      }
    } catch (error) {
      if (!current()) return;
      ui('account-status').textContent = error.message;
      ui('account-login').disabled = false;
    } finally {
      if (generation === accountRequestGeneration) {
        ui('account-refresh').disabled = false; ui('account-cancel').disabled = false;
        if (!connection.current()) ui('account-login').disabled = false;
      }
    }
  }
