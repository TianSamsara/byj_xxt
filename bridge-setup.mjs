import { randomBytes } from 'node:crypto';

export function setupPage(token) {
  const nonce = randomBytes(18).toString('base64');
  const escaped = String(token).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return {
    headers: {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Referrer-Policy': 'no-referrer'
    },
    html: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>白玉京 · 本地连接密钥</title><style nonce="${nonce}">
body{margin:0;background:#f4f7fb;color:#253855;font:16px/1.7 system-ui,sans-serif}main{max-width:560px;margin:10vh auto;padding:32px;background:white;border:1px solid #dce5f2;border-radius:18px}
h1{font-size:25px;margin:0 0 12px}p{color:#65748b}label{display:block;font-weight:600}input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;padding:12px;margin:12px 0}
input{border:1px solid #bccce4}button{background:#2458d3;color:white;border:0;cursor:pointer;font-weight:650}button.secondary{background:#edf2fc;color:#304b77}#status{min-height:3em;color:#304b77}
@media(max-width:640px){main{margin:24px 16px;padding:24px}}
</style><main><h1>复制本地连接密钥</h1><p>复制后，返回学习通助手，在 API Key / 本地连接密钥输入框按 Ctrl+V 粘贴，再获取模型并保存。</p>
<label for="local-key">本机桥接密钥</label><input id="local-key" type="password" readonly autocomplete="off" value="${escaped}" aria-label="本机桥接密钥">
<button id="copy-key">复制密钥到剪贴板</button><button id="select-key" class="secondary">选中密钥，手动复制</button><p id="status" role="status" aria-live="polite">点击复制按钮。页面不会自动读取你的剪贴板。</p></main>
<script nonce="${nonce}">
const keyInput = document.getElementById('local-key');
const status = document.getElementById('status');
function selectKey() { keyInput.type = 'text'; keyInput.focus(); keyInput.select(); keyInput.setSelectionRange(0, keyInput.value.length); }
document.getElementById('select-key').onclick = () => { selectKey(); status.textContent = '密钥已选中，请按 Ctrl+C 复制，然后返回学习通粘贴。'; };
document.getElementById('copy-key').onclick = async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(keyInput.value);
    status.textContent = '密钥已复制。返回学习通，在密钥框按 Ctrl+V 粘贴。';
  } catch {
    selectKey();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch {}
    status.textContent = copied ? '密钥已复制。返回学习通，在密钥框按 Ctrl+V 粘贴。' : '浏览器未允许自动复制。密钥已选中，请按 Ctrl+C 手动复制。';
  }
};
</script></html>`
  };
}
