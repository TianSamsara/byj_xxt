import { Codex } from './bridge.mjs';
const webSmoke = process.argv.includes('--web-smoke');
const c = new Codex(undefined, process.cwd(), webSmoke);
c.child.stderr.on('data', b => process.stderr.write(b));
const timer = setTimeout(() => c.close(), 20000);
try {
  await c.init();
  const a = await c.rpc('account/read', { refreshToken: false });
  console.log('accountType:', a.account?.type || '未登录');
  const m = await c.models();
  console.log('models:', JSON.stringify(m));
  if (process.argv.includes('--smoke') || webSmoke) {
    clearTimeout(timer);
    const smokeTimer = setTimeout(() => c.close(), webSmoke ? 180000 : 90000);
    try {
      const effort = process.argv.find(arg => arg.startsWith('--effort='))?.slice('--effort='.length);
      const content = webSmoke
        ? '请实际使用网页搜索，分别查阅 NASA 和 ESA 的公开网页，简要对比两者对火星为何呈红色的解释。只输出 JSON：{"status":"ok","answer":"一两句说明及两个来源标题和完整https链接"}。检索失败返回 status 为 needs_review；不要编造检索。'
        : '请仅回复 OK。不要使用工具。';
      const result = await c.answer({ model: m.data[0].id, web_search: webSmoke, ...(effort ? { reasoning_effort: effort } : {}), messages: [{ role: 'user', content }] }, process.cwd());
      console.log('smoke:', JSON.stringify(result));
      if (webSmoke && !result.web_search?.requests) throw new Error('未观察到真实网页搜索事件');
    } finally { clearTimeout(smokeTimer); }
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { clearTimeout(timer); c.close(); }
