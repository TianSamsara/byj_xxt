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
