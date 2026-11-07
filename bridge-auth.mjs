// Official app-server owns OAuth, credential persistence and refresh. This module
// exposes only account type/plan and the pending authorization ceremony.
export function officialLoginURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['auth.openai.com', 'auth0.openai.com', 'chatgpt.com'].includes(url.hostname) ||
      url.username || url.password || (url.port && url.port !== '443') || url.hash)
    throw new Error('授权地址不是受信任的官方登录页面');
  return url.href;
}
export class BridgeAuth {
  constructor({ Client, binary, cwd, onAuthenticated = () => {}, rpcTimeoutMs = 20000, loginTimeoutMs = 600000, idleMs = 60000 }) {
    Object.assign(this, { Client, binary, cwd, onAuthenticated, rpcTimeoutMs, loginTimeoutMs, idleMs });
    this.login = { status: 'idle' }; this.account = null; this.queue = Promise.resolve(); this.closed = false;
    this.earlyEvents = new Map();
  }
  view() { return { account: this.account, login: { ...this.login } }; }
  get pending() { return ['starting', 'pending', 'verifying'].includes(this.login.status); }
  _drop() {
    clearTimeout(this.idleTimer);
    const client = this.client; this.client = null;
    client?.close();
  }
  _bounded(promise) {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => { if (this.pending) this._finish(false); this._drop(); reject(new Error('官方登录接口等待超时，请重试')); }, this.rpcTimeoutMs);
      timer.unref?.();
    })]).finally(() => clearTimeout(timer));
  }
  async _connect() {
    clearTimeout(this.idleTimer);
    if (!this.client || this.client.dead) {
      const client = new this.Client(this.binary, this.cwd, false);
      this.client = client;
      client.onEvent = event => {
        if (this.client !== client || event.method !== 'account/login/completed') return;
        const info = event.params;
        if (!info || typeof info.loginId !== 'string') return;
        if (this.login.status === 'starting') {
          this.earlyEvents.set(info.loginId, info.success === true);
          if (this.earlyEvents.size > 8) this.earlyEvents.delete(this.earlyEvents.keys().next().value);
        } else if (this.login.status === 'pending' && this.login.loginId === info.loginId) this._finish(info.success === true);
      };
      client.onFailure = () => {
        if (this.client !== client) return;
        this.client = null;
        if (this.pending) this._finish(false);
      };
      try { await this._bounded(client.init()); }
      catch { this._drop(); throw new Error('无法连接本机 Codex 登录接口，请更新 Codex 后重试'); }
    }
    return this.client;
  }
  async _rpc(method, params) {
    const client = await this._connect();
    return this._bounded(client.rpc(method, params));
  }
  _finish(success) {
    clearTimeout(this.loginTimer);
    // Remove the code and authorization URL as soon as the attempt finishes.
    this.login = { status: success ? 'verifying' : 'failed' };
    if (success) void this._run(() => this._read()).catch(() => { this.login = { status: 'failed' }; this._drop(); });
    else if (this.client) {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => this._drop(), this.idleMs);
      this.idleTimer.unref?.();
    }
  }
  _run(action) {
    const operation = this.queue.then(async () => {
      if (this.closed) throw new Error('桥接登录服务已关闭');
      try { return await action(); }
      finally {
        if (!this.pending && !this.closed && this.client) {
          clearTimeout(this.idleTimer);
          this.idleTimer = setTimeout(() => this._drop(), this.idleMs);
          this.idleTimer.unref?.();
        }
      }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  async _read() {
    let result;
    try { result = await this._rpc('account/read', { refreshToken: false }); }
    catch { throw new Error('无法读取 Codex 登录状态，请检查 Codex 是否可用后重试'); }
    const raw = result?.account;
    this.account = raw ? { type: raw.type === 'chatgpt' ? 'chatgpt' : 'other',
      ...(raw.type === 'chatgpt' && typeof raw.planType === 'string' ? { planType: raw.planType.slice(0, 40) } : {}) } : null;
    if (this.login.status === 'verifying') {
      this.login = { status: this.account?.type === 'chatgpt' ? 'succeeded' : 'failed' };
      if (this.login.status === 'succeeded') this.onAuthenticated();
    }
    return this.view();
  }
  status() { return this._run(() => this._read()); }
  start(flow) {
    if (!['browser', 'device'].includes(flow)) return Promise.reject(new Error('请选择浏览器授权或设备码授权'));
    return this._run(async () => {
      if (this.pending) return this.view();
      await this._read();
      if (this.account?.type === 'chatgpt') return this.view();
      this.login = { status: 'starting' }; this.earlyEvents.clear();
      try {
        const result = await this._rpc('account/login/start', { type: flow === 'browser' ? 'chatgpt' : 'chatgptDeviceCode' });
        if (typeof result?.loginId !== 'string' || !result.loginId || result.loginId.length > 200 ||
          result.type !== (flow === 'browser' ? 'chatgpt' : 'chatgptDeviceCode')) throw new Error('Invalid login response');
        const url = officialLoginURL(flow === 'browser' ? result.authUrl : result.verificationUrl);
        if (flow === 'device' && (typeof result.userCode !== 'string' || !/^[A-Za-z0-9-]{4,32}$/.test(result.userCode))) throw new Error('Invalid code');
        this.login = { status: 'pending', flow, loginId: result.loginId, url,
          ...(flow === 'device' ? { userCode: result.userCode } : {}), expiresAt: Date.now() + this.loginTimeoutMs };
        this.loginTimer = setTimeout(() => {
          this.login = { status: 'expired' }; this._drop();
        }, this.loginTimeoutMs);
        this.loginTimer.unref?.();
        if (this.earlyEvents.has(result.loginId)) this._finish(this.earlyEvents.get(result.loginId));
        this.earlyEvents.clear();
        return this.view();
      } catch {
        this._finish(false); this._drop();
        throw new Error(flow === 'device'
          ? '设备码授权未能启动。请更新 Codex 并在 ChatGPT 安全设置允许设备码登录，或改用浏览器授权'
          : '官方登录未能启动，请更新 Codex；若本机回调端口被占用，可改用设备码授权');
      }
    });
  }
  cancel(loginId) {
    return this._run(async () => {
      if (this.login.status !== 'pending') return this.view();
      if (loginId !== this.login.loginId) throw new Error('本次授权已改变，请刷新登录状态');
      try { await this._rpc('account/login/cancel', { loginId }); }
      catch { this._drop(); throw new Error('取消授权未确认，请刷新登录状态'); }
      finally { clearTimeout(this.loginTimer); this.login = { status: 'cancelled' }; this._drop(); }
      return this.view();
    });
  }
  close() { this.closed = true; clearTimeout(this.loginTimer); this._drop(); }
}
