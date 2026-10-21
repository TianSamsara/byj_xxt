window.__ModuleLoader__.load({
  id: 'dsh-plugin-codex-local-bridge',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    const NS = 'codexBridge';
    const initial = { phase: 'idle', root: '', baseURL: '', model: '', effort: '', models: [], candidates: [], remembered: false, autoConnect: true, autoStart: true, makeDefault: true, lastError: '' };
    const labels = { idle: '尚未连接', discovering: '正在发现本地桥接', found: '已找到桥接', offline: '桥接未运行', connecting: '正在连接', starting: '正在启动桥接', 'loading-models': '正在获取模型', connected: '已连接', error: '连接需要处理' };
    const effortNames = { off: '关闭', minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高' };
    const css = `
      .dcb{--dcb-blue:#376ad5;--dcb-green:#288366;color:var(--dsw-alias-label-primary,#17233f);font-family:inherit;font-size:14px;width:100%;max-width:760px;min-height:0;overflow:auto;margin:0 auto;padding:28px 24px 48px;box-sizing:border-box}
      .dcb *{box-sizing:border-box}.dcb h2{font-size:21px;font-weight:650;letter-spacing:-.4px;margin:0 0 6px}.dcb p{margin:0}.dcb .muted{color:var(--dsw-alias-label-secondary,#657188);font-size:12px;line-height:1.7}.dcb .head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:25px}.dcb .state{display:flex;align-items:center;gap:7px;white-space:nowrap;font-size:12px}.dcb .dot{height:8px;width:8px;border-radius:50%;background:#b5722c}.dcb .dot.online{background:var(--dcb-green)}.dcb .actions{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 23px}.dcb button{border:1px solid var(--dsw-alias-border-primary,#d9dfeb);background:var(--dsw-alias-fill-secondary,#f6f7fa);color:inherit;font:inherit;font-size:13px;min-height:36px;border-radius:8px;padding:8px 15px;cursor:pointer}.dcb button.primary{background:var(--dcb-blue);border-color:var(--dcb-blue);color:#fff;font-weight:600}.dcb button:disabled{opacity:.5;cursor:wait}.dcb button:focus-visible,.dcb input:focus-visible,.dcb select:focus-visible{outline:2px solid var(--dcb-blue);outline-offset:3px}.dcb .field{display:grid;gap:8px;margin-bottom:18px;font-size:13px;font-weight:550}.dcb input[type=text],.dcb select{width:100%;min-width:0;border:1px solid var(--dsw-alias-border-primary,#d9dfeb);border-radius:8px;background:var(--dsw-alias-fill-primary,#fff);color:inherit;padding:10px 11px;font:inherit;font-weight:400;font-size:13px}.dcb .row{display:grid;grid-template-columns:1.4fr 1fr;gap:16px}.dcb .preferences{display:grid;gap:14px;padding:18px 0;border-top:1px solid var(--dsw-alias-border-primary,#e6e9ef);border-bottom:1px solid var(--dsw-alias-border-primary,#e6e9ef);margin-top:6px}.dcb .option{display:flex;align-items:center;gap:10px;font-size:13px}.dcb input[type=checkbox]{width:16px;height:16px;accent-color:var(--dcb-blue);margin:0}.dcb .notice{border-left:3px solid #b5722c;padding:8px 12px;margin:15px 0;background:var(--dsw-alias-fill-secondary,#f6f7fa);font-size:13px;line-height:1.7;overflow-wrap:anywhere}.dcb .notice.good{border-color:var(--dcb-green)}.dcb .details{display:grid;grid-template-columns:85px minmax(0,1fr);gap:10px 14px;margin:23px 0;font-size:12px;line-height:1.7}.dcb dt{color:var(--dsw-alias-label-tertiary,#7c8598)}.dcb dd{margin:0;overflow-wrap:anywhere}.dcb .endpoint{font-family:ui-monospace,Consolas,monospace}.dcb .footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.dcb .quiet{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#657188);padding-left:0}.dcb .empty{padding:16px 0}.dcb .candidates{margin-top:8px;display:grid;gap:5px}.dcb .candidate{text-align:left;overflow-wrap:anywhere;white-space:normal}.dcb .progress{color:var(--dcb-blue)}@media(max-width:520px){.dcb .row{grid-template-columns:1fr;gap:0}.dcb .head{align-items:flex-start;flex-direction:column;gap:9px}.dcb .details{grid-template-columns:70px minmax(0,1fr)}.dcb .footer{align-items:flex-start;flex-direction:column}}
    `;

    function Icon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
        h('path', { d: 'm8 5-5 7 5 7m8-14 5 7-5 7M14 3l-4 18M8 12h8', strokeLinecap: 'round', strokeLinejoin: 'round' }));
    }

    function Panel({ api, view }) {
      const [state, setState] = React.useState(initial);
      const [form, setForm] = React.useState({ root: '', model: '', effort: '', autoConnect: true, autoStart: true, makeDefault: true });
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const mounted = React.useRef(false), dirty = React.useRef(false);
      const accept = React.useCallback(next => {
        if (!mounted.current) return;
        setState(next);
        if (!dirty.current) setForm({ root: next.root || '', model: next.model || '', effort: next.effort || '', autoConnect: next.autoConnect, autoStart: next.autoStart, makeDefault: next.makeDefault });
      }, []);
      React.useEffect(() => {
        mounted.current = true;
        const refresh = async () => { try { const result = await api.status(); if (result.ok) accept(result.value); else if (mounted.current) setNotice(result.error.message); } catch (e) { if (mounted.current) setNotice(e.message); } };
        void refresh(); const timer = setInterval(refresh, 2500);
        return () => { mounted.current = false; clearInterval(timer); };
      }, [api, accept]);
      if (view === 'summary') return '自动发现并记住 Codex 本地桥接，选择模型与思考强度。';
      const edit = (name, value) => { dirty.current = true; setForm(f => ({ ...f, [name]: value })); };
      const run = async (method, request) => {
        if (busy) return; setBusy(true); setNotice('');
        try {
          const result = await api[method](...(request === undefined ? [] : [request]));
          if (!result.ok) throw new Error(result.error.message);
          dirty.current = false; accept(result.value);
          if (mounted.current) setNotice(method === 'connect' ? '已记住并接入 Harness。新会话使用所选模型；已有会话可在输入框的模型菜单切换。' : method === 'forget' ? '已取消记忆和自动重连，Harness 中已有的模型配置保留。' : result.value.candidates.length ? `发现 ${result.value.candidates.length} 个本地桥接。选择后点击连接。` : '未发现桥接，请填写桥接目录。');
        } catch (e) { if (mounted.current) setNotice(e.message); }
        finally { if (mounted.current) setBusy(false); }
      };
      const selected = state.models.find(m => m.id === form.model);
      const working = busy || ['connecting', 'starting', 'loading-models', 'discovering'].includes(state.phase);
      const field = (label, input, hint) => h('label', { className: 'field' }, label, input, hint && h('span', { className: 'muted' }, hint));
      const option = (id, label) => h('label', { className: 'option' }, h('input', { type: 'checkbox', checked: Boolean(form[id]), disabled: working, onChange: e => edit(id, e.target.checked) }), label);
      return h('section', { className: 'dcb', 'aria-label': 'Codex 本地桥接' },
        h('header', { className: 'head' }, h('div', null, h('h2', null, 'Codex 本地桥接'), h('p', { className: 'muted' }, '找到一次，以后自动连接。')),
          h('div', { className: 'state', role: 'status', 'aria-live': 'polite' }, h('span', { className: `dot ${state.phase === 'connected' ? 'online' : ''}` }), labels[state.phase] || state.phase)),
        h('div', { className: 'actions' },
          h('button', { disabled: working, onClick: () => run('discover') }, '自动发现'),
          h('button', { className: 'primary', disabled: working || !form.root.trim(), onClick: () => run('connect', form) }, working ? '正在处理…' : '连接并记住'),
          h('button', { disabled: working || !form.root.trim(), onClick: () => run('connect', { ...form, autoStart: true }) }, '启动并连接')),
        field('桥接文件夹', h('input', { type: 'text', value: form.root, placeholder: '包含 server.mjs 和 Start-Bridge.ps1 的文件夹', disabled: working, onChange: e => edit('root', e.target.value) }), '会在本机读取连接密钥，面板不显示密钥。'),
        state.candidates.length > 1 && h('div', { className: 'candidates' }, ...state.candidates.map(c => h('button', { key: c.root, className: 'candidate', disabled: working, onClick: () => edit('root', c.root) }, `${c.online ? '运行中' : '未运行'}：${c.root}`))),
        h('div', { className: 'row' },
          field('模型', h('select', { value: form.model, disabled: working || !state.models.length, onChange: e => { edit('model', e.target.value); edit('effort', state.models.find(m => m.id === e.target.value)?.defaultEffort || ''); } },
            !state.models.length && h('option', { value: '' }, '连接后自动获取模型'), ...state.models.map(m => h('option', { key: m.id, value: m.id }, m.name)))),
          field('思考强度', h('select', { value: form.effort, disabled: working || !selected, onChange: e => edit('effort', e.target.value) }, h('option', { value: '' }, '模型默认'), ...(selected?.efforts || []).map(e => h('option', { key: e, value: e }, `${effortNames[e] || e}（${e}）`))))),
        h('div', { className: 'preferences' }, option('autoConnect', '启动 Harness 时自动连接'), option('autoStart', '桥接离线时自动启动'), option('makeDefault', '设为新会话的默认模型')),
        (notice || state.lastError) && h('div', { className: `notice ${state.phase === 'connected' && !state.lastError ? 'good' : ''}`, role: state.lastError ? 'alert' : 'status' }, state.lastError || notice),
        working && h('p', { className: 'muted progress', role: 'status' }, `${labels[state.phase] || '正在保存'}，首次获取模型可能需要一些时间。`),
        h('dl', { className: 'details' }, h('dt', null, '桥接地址'), h('dd', { className: 'endpoint' }, state.baseURL || '等待发现'), h('dt', null, '模型数量'), h('dd', null, state.models.length ? `${state.models.length} 个可用模型` : '尚未读取'), h('dt', null, '连接记忆'), h('dd', null, state.remembered ? '已保存在本机，下次可自动连接' : '尚未记住'), state.lastConnected && h(React.Fragment, null, h('dt', null, '最近连接'), h('dd', null, new Date(state.lastConnected).toLocaleString()))),
        h('footer', { className: 'footer' }, h('p', { className: 'muted' }, '模型调用使用本机 Codex 的登录状态和可用额度。'), h('button', { className: 'quiet', disabled: working || !state.remembered, onClick: () => run('forget') }, '忘记此连接')));
    }

    class PanelBoundary extends React.Component {
      constructor(props) { super(props); this.state = { error: '' }; }
      static getDerivedStateFromError(error) { return { error: String(error.message || error).slice(0, 200) }; }
      render() { return this.state.error ? h('section', { className: 'dcb' }, h('h2', null, 'Codex 本地桥接'), h('p', { role: 'alert', className: 'notice' }, `面板暂时无法显示：${this.state.error}`), h('button', { onClick: () => this.setState({ error: '' }) }, '重试显示')) : this.props.children; }
    }
    const BridgePanel = props => h(PanelBoundary, null, h(Panel, props));
    const methods = ['status', 'discover', 'connect', 'forget', 'reconnect'];
    const descriptors = methods.map(method => ({ id: `dsh-plugin-codex-local-bridge#codexBridge/${method}`, service: 'codexBridge', namespace: NS, method,
      invocation: { kind: 'direct' },
      parameters: method === 'connect' ? [{ name: 'request', wire: 'request', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-plugin-codex-local-bridge#ConnectRequest',
        create: () => ({ parse: value => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('连接参数格式错误'); return value; } }), jsonSchema: { type: 'object' } } }] : [],
      result: { mode: 'src-json' }
    }));
    async function apply(ctx) {
      await ctx.remote.$mount({ package: 'dsh-plugin-codex-local-bridge', descriptors, methods: {} });
      const tag = document.createElement('style'); tag.dataset.plugin = 'dsh-plugin-codex-local-bridge'; tag.textContent = css; document.head.appendChild(tag);
      ctx.effect(() => () => tag.remove());
      const api = Object.fromEntries(methods.map(method => [method, (...args) => ctx.get('remote.codexBridge')[method](...args)]));
      const inject = () => ({ api });
      // Cross the normal Remote boundary after client boot. Config writes inside Host HMR
      // activation inherit its transaction and cannot safely open another transaction.
      ctx.effect(() => {
        const reconnect = () => { void api.reconnect().catch(() => {}); };
        reconnect();
        const timer = setInterval(reconnect, 30000);
        return () => clearInterval(timer);
      });
      ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-plugin-codex-local-bridge', inject }, BridgePanel)));
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'codex-local-bridge', inject }, BridgePanel)));
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'codex-local-bridge', order: 10, label: () => 'Codex 桥接' }, Icon)));
    }
    return { apply, inject: ['slots', 'remote', 'layout'], Panel, Icon };
  }
});
