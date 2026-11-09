  function isExamURL(value) {
    if (!value) return false;
    try {
      const url = new URL(value, location.href);
      return ['https:', 'http:'].includes(url.protocol) && /(^|\.)chaoxing\.com$/i.test(url.hostname) &&
        (/exam/i.test(url.pathname) || [...url.searchParams.keys()].some(name => /^(examid|examanswerid)$/i.test(name)));
    } catch { return false; }
  }

  function isExamRoute() {
    if (isExamURL(location.href)) return true;
    if (window !== window.top && isExamURL(document.referrer)) return true;
    for (let frame = window; frame !== frame.parent;) {
      frame = frame.parent;
      try { if (isExamURL(frame.location.href)) return true; } catch { /* Cross-origin ancestor. */ }
    }
    for (const frame of document.querySelectorAll('iframe[src], frame[src]')) {
      if (isExamURL(frame.src)) return true;
      try { if (isExamURL(frame.contentWindow?.location.href)) return true; } catch { /* Cross-origin child. */ }
    }
    return false;
  }

  function showExamProtectionNotice() {
    if (window !== window.top || !document.body || document.getElementById('xxt-assistant-exam-status')) return;
    const host = document.createElement('div');
    host.id = 'xxt-assistant-exam-status';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host{position:fixed;left:16px;bottom:16px;z-index:2147483647;max-width:calc(100vw - 32px)}
      section{box-sizing:border-box;width:340px;max-width:100%;padding:14px;border:1px solid #cbd8ea;border-radius:12px;background:#fff;color:#22324c;font:14px/1.5 system-ui,sans-serif;box-shadow:0 4px 18px #24375426}
      strong{display:block;font-size:15px}p{margin:4px 0 10px}
      button{min-height:44px;padding:6px 12px;border:1px solid #a0b5d3;border-radius:8px;background:#f4f7fc;color:#22324c;font:inherit;cursor:pointer}
      button:focus-visible{outline:2px solid #2457b3;outline-offset:2px}`;
    const section = document.createElement('section');
    section.setAttribute('aria-label', '学习通助手考试状态');
    const title = document.createElement('strong');
    title.textContent = '学习通助手 · 考试保护已启用';
    const detail = document.createElement('p');
    detail.textContent = '当前是考试页。扫描、AI 作答、填答和自动交卷均已停用。';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '关闭提示';
    close.addEventListener('click', () => host.remove());
    section.append(title, detail, close);
    shadow.append(style, section);
    document.body.append(host);
  }

  // Run before installing the normal assistant, including frame handlers and course automation.
  if (isExamRoute()) {
    showExamProtectionNotice();
    return;
  }
