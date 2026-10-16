  function answerTextComparable(value) {
    // UEditor 的填充字符没有可见正文含义；仍保留单词之间的空格和所有标点。
    return clean(String(value ?? '').replace(/[\u200b\ufeff]/g, ''));
  }

  function editorHTMLText(html, doc) {
    const template = doc.createElement('template');
    // textContent 本身不为 br / 段落生成分隔符，必须在解析前保留这些边界。
    template.innerHTML = String(html ?? '')
      .replace(/<br\b[^>]*>/gi, '\n')
      .replace(/<\/(?:p|div|li|h[1-6]|tr|table|blockquote|pre|section|article|ul|ol)\s*>/gi, '\n');
    return template.content.textContent || '';
  }

  function readEditorAnswer(editor, doc) {
    if (typeof editor.body?.innerHTML === 'string') return editorHTMLText(editor.body.innerHTML, doc);
    if (typeof editor.getContent === 'function') return editorHTMLText(editor.getContent(), doc);
    if (typeof editor.getPlainTxt === 'function') return editor.getPlainTxt();
    if (typeof editor.getContentTxt === 'function') return editor.getContentTxt();
    return editor.body?.innerText ?? editor.body?.textContent ?? null;
  }
