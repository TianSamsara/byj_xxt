import { Codex } from './bridge.mjs';
const c = new Codex();
c.child.stderr.on('data', b => process.stderr.write(b));
const timer = setTimeout(() => c.close(), 20000);
try {
  await c.init();
  const a = await c.rpc('account/read', { refreshToken: false });
  console.log('accountType:', a.account?.type || '未登录');
  const m = await c.models();
  console.log('models:', JSON.stringify(m));
  if (process.argv.includes('--smoke')) {
    clearTimeout(timer);
    const smokeTimer = setTimeout(() => c.close(), 90000);
    try {
      const effort = process.argv.find(arg => arg.startsWith('--effort='))?.slice('--effort='.length);
      const result = await c.answer({ model: m.data[0].id, ...(effort ? { reasoning_effort: effort } : {}), messages: [{ role: 'user', content: '请仅回复 OK。不要使用工具。' }] }, process.cwd());
      console.log('smoke:', JSON.stringify(result));
    } finally { clearTimeout(smokeTimer); }
  }
} catch (e) { console.error(e.message); process.exitCode = 1; }
finally { clearTimeout(timer); c.close(); }
