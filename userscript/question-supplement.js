  const questionSupplements = new Map();
  const supplementNodeIds = new WeakMap();
  let supplementNodeSequence = 0;
  const MAX_QUESTION_SUPPLEMENT = 1200;

  function questionSupplementId(container) {
    if (!supplementNodeIds.has(container)) supplementNodeIds.set(container, `${frameId}:${++supplementNodeSequence}`);
    return supplementNodeIds.get(container);
  }

  function questionSupplementKey(item) {
    return JSON.stringify([item.supplementId, item.pageUrl, item.type, item.title,
      item.options.map(option => [option.letter, option.text]), item.images || []]);
  }

  function withQuestionSupplement(item) {
    const userSupplement = questionSupplements.get(questionSupplementKey(item));
    return userSupplement ? { ...item, userSupplement } : item;
  }

  function appendQuestionSupplement(card, item, index) {
    const key = questionSupplementKey(item);
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = '补充给 AI（选填）';
    const input = document.createElement('textarea');
    input.className = 'field question-supplement';
    input.rows = 2;
    input.maxLength = MAX_QUESTION_SUPPLEMENT;
    input.placeholder = '例如：我的主修专业是人力资源管理，希望以招聘专员为例';
    input.value = questionSupplements.get(key) || '';
    input.disabled = busy;
    const hint = document.createElement('small');
    hint.className = 'question-supplement-hint';
    hint.id = `question-supplement-hint-${index}`;
    hint.textContent = '仅当前页面保留。作答时发送给所选 AI，跳过共享题库。';
    input.setAttribute('aria-describedby', hint.id);
    input.addEventListener('input', () => {
      const value = input.value.trim().slice(0, MAX_QUESTION_SUPPLEMENT);
      if (value) questionSupplements.set(key, value);
      else questionSupplements.delete(key);
    });
    label.append(input);
    card.append(label, hint);
  }
