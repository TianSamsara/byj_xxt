  function blankTargets(container) {
    const targets = [], covered = new Set(), seenEditors = new Set();
    const roots = [window];
    try { if (typeof unsafeWindow !== 'undefined') roots.unshift(unsafeWindow); } catch { /* 沙箱 */ }
    const inQuestion = node => node?.nodeType === 1 && container.contains(node);
    const editorShell = node => node?.closest?.('.edui-editor,.edui-container');
    const sameNode = (a, b) => a === b || Boolean(a?.isSameNode?.(b));
    const cover = nodes => { for (const node of nodes) covered.add(node); };
    // 学习通的 .eidtDiv / .textDIV 可以包住整个 UEditor；祖先包装与编辑器内部均不是第二个答题区。
    const isCovered = node => [...covered].some(root => sameNode(root, node) || root.contains(node) ||
      (node.matches('.eidtDiv,.textDIV,[contenteditable="true"]') && node.contains(root)));
    for (const root of roots) {
      // 两个注册表可以同时存在，不能因其中一个为空就漏掉另一个。
      let registries;
      try { registries = [root.UE?.instants, root.UE?.instances].filter(Boolean); } catch { continue; }
      for (const instances of registries) for (const [key, editor] of Object.entries(instances)) {
        if (!editor?.setContent || seenEditors.has(editor)) continue;
        const ids = [key, editor.key, editor.id, editor.options?.textarea].filter(v => typeof v === 'string' && v);
        const direct = [editor.container, editor.iframe, editor.textarea, editor.options?.textarea,
          ...ids.map(id => container.ownerDocument.getElementById(id))].filter(inQuestion);
        if (!direct.length) continue;
        if (!direct.some(node => !node.closest('[hidden],[aria-hidden="true"]') && displayVisible(node))) continue;
        seenEditors.add(editor);
        const shells = direct.map(editorShell).filter(inQuestion);
        const nodes = [...new Set([...direct, ...shells])];
        // editorValue 等默认 name 可能在多空题中重复，只合并能唯一关联的提交字段。
        for (const id of ids) {
          const named = all(container, '[name]').filter(node => node.getAttribute('name') === id);
          for (const node of named) if (named.length === 1 || nodes.some(parent => parent.contains(node))) nodes.push(node);
        }
        // unsafeWindow/window 的代理对象可能不同，但指向同一个 DOM 编辑器。
        const existing = targets.find(target => target.kind === 'editor' && target.nodes.some(node => nodes.some(other => sameNode(node, other))));
        cover(nodes);
        if (existing) { existing.nodes = [...new Set([...existing.nodes, ...nodes])]; continue; }
        targets.push({ kind: 'editor', node: direct[0], editor, nodes: [...new Set(nodes)] });
      }
    }
    const raw = all(container, 'textarea,input[type="text"],input:not([type]),[contenteditable="true"],.eidtDiv,.textDIV,iframe')
      .filter(node => !isCovered(node) && !node.closest('#xxt-assistant-host') &&
        !node.closest('.edui-toolbar,.edui-editor-toolbarbox,.edui-toolbarbox,[role="toolbar"]') &&
        !node.closest('[hidden],[aria-hidden="true"]') && !node.disabled && !node.readOnly && displayVisible(node));
    for (const node of raw) {
      if (raw.some(other => other !== node && node.contains(other))) continue;
      if (node.matches('iframe')) {
        try {
          const doc = node.contentDocument;
          const body = doc?.body;
          if (body && (body.isContentEditable || body.getAttribute('contenteditable') === 'true' || doc.designMode === 'on'))
            targets.push({ kind: 'frame', node, body });
          else if (editorShell(node) || /ueditor/i.test(node.id)) targets.push({ kind: 'unready', node });
        } catch { targets.push({ kind: 'unready', node }); }
      } else if (editorShell(node)) {
        // 未注册的编辑器内部控件不能按独立输入框处理；等待编辑器注册后重试。
        if (node.matches('textarea,[contenteditable="true"]')) targets.push({ kind: 'unready', node });
      } else targets.push({ kind: node.matches('input,textarea') ? 'input' : 'editable', node });
    }
    return targets.filter((target, index) => targets.findIndex(other => sameNode(other.node, target.node)) === index)
      .sort((a, b) => a.node.compareDocumentPosition(b.node) & 2 ? 1 : -1);
  }

