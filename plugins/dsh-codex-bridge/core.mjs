import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const EFFORTS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const safeError = error => String(error?.message || error).replace(/Bearer\s+\S+|[a-f0-9]{48,}/gi, '[隐藏密钥]').slice(0, 240);
const readJSON = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const exists = async file => { try { return (await fs.stat(file)).isFile(); } catch { return false; } };

export function localBaseURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname))
    throw new Error('只允许 http://127.0.0.1:端口/v1 本机桥接地址');
  return `${url.origin}/v1`;
}

export function modelChoices(rows) {
  if (!Array.isArray(rows)) throw new Error('桥接返回的模型列表格式不正确');
  const seen = new Set();
  return rows.slice(0, 100).filter(row => row && /^[\w.:-]{1,120}$/.test(row.id || '') && !seen.has(row.id) && seen.add(row.id)).map(row => ({
    id: row.id, name: String(row.name || row.id).slice(0, 160),
    defaultEffort: EFFORTS.has(row.defaultReasoningEffort) ? row.defaultReasoningEffort : '',
    efforts: [...new Set((Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts : []).map(e => e?.reasoningEffort).filter(e => EFFORTS.has(e)))]
  }));
}

export async function inspectRoot(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('请填写桥接文件夹的完整路径');
  const root = await fs.realpath(input);
  const server = path.join(root, 'server.mjs'), launcher = path.join(root, 'Start-Bridge.ps1');
  const source = await fs.readFile(server, 'utf8');
  if (!source.includes('dsh-codex-bridge') || !source.includes('ChatGPT')) throw new Error('此目录不是 Harness 的 Codex 桥接（学习通桥接不能用于 Harness 工具调用）');
  const config = await readJSON(path.join(root, 'settings.json'));
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('桥接端口配置错误');
  const keyFile = path.join(root, 'state', 'local-key');
  const key = (await fs.readFile(keyFile, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('本地连接密钥文件格式错误');
  const launcherSource = await fs.readFile(launcher, 'utf8');
  return { root, server, launcher, key, keyFile, baseURL: localBaseURL(`http://127.0.0.1:${config.port}/v1`),
    fingerprint: createHash('sha256').update(source).update('\0').update(launcherSource).digest('hex') };
}

export async function searchRoots({ home = os.homedir(), dshHome, remembered, extraRoots = [] } = {}) {
  const roots = new Set([remembered?.root, process.env.DSH_CODEX_BRIDGE_ROOT, ...extraRoots].filter(Boolean));
  const documentRoot = path.join(home, 'Documents', 'Codex');
  let dates = [];
  try { dates = (await fs.readdir(documentRoot, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 20); } catch {}
  let budget = 160;
  for (const date of dates) {
    const day = path.join(documentRoot, date.name);
    const tasks = (await fs.readdir(day, { withFileTypes: true })).filter(d => d.isDirectory()).slice(0, 30);
    for (const task of tasks) {
      if (--budget < 0) break;
      const root = path.join(day, task.name, 'outputs', 'codex-harness-bridge');
      if (await exists(path.join(root, 'settings.json'))) roots.add(root);
    }
    if (budget < 0) break;
  }
  const found = [];
  for (const root of [...roots].slice(0, 20)) {
    try { const candidate = await inspectRoot(root); if (!found.some(r => r.root === candidate.root)) found.push(candidate); } catch {}
  }
  return found;
}

export async function bridgeJSON(candidate, route, { fetcher = fetch, timeoutMs = 3000 } = {}) {
  const url = new URL(route, candidate.baseURL + '/');
  if (url.origin !== new URL(localBaseURL(candidate.baseURL)).origin) throw new Error('拒绝访问其他地址');
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${candidate.key}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 401) throw new Error('桥接密钥已更改，请重新发现或检查桥接目录');
  if (!response.ok) throw new Error(`本机桥接返回 HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 1024 * 1024) throw new Error('桥接响应过大');
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('桥接响应过大'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function startLauncher(candidate) {
  if (process.platform !== 'win32') throw new Error('当前自动启动器仅支持 Windows，请先手动运行桥接');
  return new Promise((resolve, reject) => {
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', candidate.launcher], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(new Error('启动器等待超时，请检查桥接日志')); }, 20000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('启动器未能启动桥接，请检查桥接日志或 Codex 路径')); });
  });
}

export class BridgeManager {
  constructor({ home = os.homedir(), dshHome = process.env.DSH_HOME || path.join(home, '.dsh'), onConnected = async () => {}, fetcher = fetch, launcher = startLauncher, extraRoots = [] } = {}) {
    Object.assign(this, { home, dshHome, onConnected, fetcher, launcher, extraRoots });
    this.file = path.join(dshHome, 'storages', 'codex-local-bridge', 'connection.json');
    this.memory = {}; this.candidates = [];
    this.state = { phase: 'idle', root: '', baseURL: '', model: '', effort: '', models: [], candidates: [], remembered: false, autoConnect: true, autoStart: true, makeDefault: true, lastError: '', lastConnected: null };
  }
  async load() {
    try { const memory = await readJSON(this.file); if (memory.version === 1) { this.memory = memory; Object.assign(this.state, { root: memory.root || '', model: memory.model || '', effort: memory.effort || '', remembered: Boolean(memory.root), autoConnect: memory.autoConnect === true, autoStart: memory.autoStart === true, makeDefault: memory.makeDefault !== false }); } } catch {}
    return this.status();
  }
  status() { return structuredClone(this.state); }
  async exclusive(work) {
    if (this.busy) throw new Error('正在处理桥接连接，请稍候');
    this.busy = true;
    try { return await work(); }
    catch (error) { this.state.phase = 'error'; this.state.lastError = safeError(error); throw new Error(this.state.lastError); }
    finally { this.busy = false; }
  }
  async find() {
    this.candidates = await searchRoots({ home: this.home, dshHome: this.dshHome, remembered: this.memory, extraRoots: this.extraRoots });
    this.state.candidates = await Promise.all(this.candidates.map(async c => {
      let online = false;
      try { online = (await bridgeJSON(c, '/health', { fetcher: this.fetcher })).service === 'dsh-codex-bridge'; } catch {}
      return { root: c.root, baseURL: c.baseURL, online, remembered: c.root === this.memory.root };
    }));
    return this.candidates;
  }
  async discover() {
    return this.exclusive(async () => {
      this.state.phase = 'discovering'; this.state.lastError = '';
      const candidates = await this.find();
      const selected = candidates.find(c => c.root === this.memory.root) || candidates[0];
      if (selected) Object.assign(this.state, { root: selected.root, baseURL: selected.baseURL, phase: 'found' });
      else Object.assign(this.state, { phase: 'offline', lastError: '未找到 Harness 桥接，请填写包含 server.mjs 和 Start-Bridge.ps1 的桥接目录' });
      return this.status();
    });
  }
  async connect(request = {}, automatic = false) {
    if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('连接参数格式错误');
    return this.exclusive(async () => {
      this.state.phase = 'connecting'; this.state.lastError = '';
      const root = request.root || this.memory.root || this.state.root;
      const candidate = await inspectRoot(root);
      const autoStart = request.autoStart ?? this.memory.autoStart ?? true;
      const autoConnect = request.autoConnect ?? this.memory.autoConnect ?? true;
      const makeDefault = request.makeDefault ?? this.memory.makeDefault ?? true;
      for (const value of [autoStart, autoConnect, makeDefault]) if (typeof value !== 'boolean') throw new Error('自动连接选项必须是布尔值');
      if (automatic && (candidate.root !== this.memory.root || candidate.fingerprint !== this.memory.fingerprint)) throw new Error('桥接文件已变化，请在面板点击“连接并记住”后继续自动连接');
      let healthy = false;
      try { healthy = (await bridgeJSON(candidate, '/health', { fetcher: this.fetcher })).service === 'dsh-codex-bridge'; } catch {}
      if (!healthy) {
        if (!autoStart) throw new Error('桥接未运行，点击“启动并连接”或开启自动启动');
        this.state.phase = 'starting';
        await this.launcher(candidate);
        healthy = (await bridgeJSON(candidate, '/health', { fetcher: this.fetcher, timeoutMs: 5000 })).service === 'dsh-codex-bridge';
      }
      if (!healthy) throw new Error('端口上的服务不是 Harness 的 Codex 桥接');
      this.state.phase = 'loading-models';
      const catalog = await bridgeJSON(candidate, '/v1/models', { fetcher: this.fetcher, timeoutMs: 60000 });
      const models = modelChoices(catalog.data);
      if (!models.length) throw new Error('桥接没有返回可用模型，请确认 Codex 已登录');
      const model = request.model || this.memory.model || this.state.model || models[0].id;
      const selected = models.find(m => m.id === model);
      if (!selected) { this.state.models = models; throw new Error('已记住的模型当前不可用，请选择列表中的模型后重新连接'); }
      const effort = request.effort ?? this.memory.effort ?? selected.defaultEffort;
      if (effort && !selected.efforts.includes(effort)) { this.state.models = models; throw new Error('当前模型不支持此思考强度，请重新选择'); }
      await this.onConnected({ candidate, models, model, effort, makeDefault });
      const memory = { version: 1, root: candidate.root, fingerprint: candidate.fingerprint, model, effort, autoConnect, autoStart, makeDefault };
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(memory, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.file);
      this.memory = memory;
      Object.assign(this.state, { phase: 'connected', root: candidate.root, baseURL: candidate.baseURL, model, effort, models, remembered: true, autoConnect, autoStart, makeDefault, lastError: '', lastConnected: new Date().toISOString() });
      return this.status();
    });
  }
  async forget() {
    return this.exclusive(async () => {
      await fs.rm(this.file, { force: true }); this.memory = {};
      Object.assign(this.state, { remembered: false, autoConnect: false, autoStart: false, lastError: '' });
      return this.status();
    });
  }
  async reconnect() {
    if (this.busy || !this.memory.autoConnect || !this.memory.root || Date.now() - (this.lastAttempt || 0) < 60000) return this.status();
    if (this.state.phase === 'connected') {
      try { const c = await inspectRoot(this.memory.root); if ((await bridgeJSON(c, '/health', { fetcher: this.fetcher })).service === 'dsh-codex-bridge') return this.status(); } catch {}
    }
    this.lastAttempt = Date.now();
    return this.connect(this.memory, true);
  }
}

export function harnessProfile({ candidate, models, model, effort }, previous = {}) {
  const profile = { ...previous, displayName: 'Codex 本地桥接', api: 'openai-completions', baseURL: candidate.baseURL,
    headers: { ...(previous.headers || {}), Authorization: `Bearer ${candidate.key}` },
    reasoning: effort || models.find(item => item.id === model)?.defaultEffort || models[0].defaultEffort || 'low', timeoutMs: 600000, streamIdleTimeoutMs: 600000,
    compat: { ...(previous.compat || {}), supportsDeveloperRole: false }, retryPolicy: { mode: 'normal', maxRetries: 1 },
    models: models.map(model => {
      const old = previous.models?.find(m => m.id === model.id);
      return { id: model.id, name: model.name, contextWindow: old?.contextWindow || 131072, maxTokens: old?.maxTokens || 16384,
        input: old?.input || ['text', 'image'], reasoningEfforts: model.efforts.length ? Object.fromEntries(model.efforts.map(e => [e, e])) : false };
    }) };
  delete profile.apiKeyEnv;
  delete profile.modelOverrides;
  return profile;
}
