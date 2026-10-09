(() => {
  const root = document.querySelector('.study');
  if (!root) return;
  const key = 'jun-study.basic-verbs.completed.v1';
  const itemPrefix = 'jun-study.basic-verbs.item.v1.';
  let completed = new Set();
  const storageNote = root.querySelector('[data-storage-note]');
  const warn = () => { if (storageNote) storageNote.hidden = false; };
  function readProgress() {
    try {
      // Retain historical records; per-item values override checks and unchecks.
      const saved = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(saved)) throw new Error('Invalid saved progress');
      const result = new Set(saved.filter(id => typeof id === 'string'));
      for (let index = 0; index < localStorage.length; index++) {
        const itemKey = localStorage.key(index);
        if (!itemKey || !itemKey.startsWith(itemPrefix)) continue;
        const id = itemKey.slice(itemPrefix.length);
        const value = localStorage.getItem(itemKey);
        if (value === '1') result.add(id);
        else if (value === '0') result.delete(id);
      }
      return result;
    } catch {
      warn();
      return completed;
    }
  }
  completed = readProgress();

  const dayLinks = [...root.querySelectorAll('[data-day-link]')];
  function updateOverview() {
    if (!dayLinks.length) return;
    let total = 0, count = 0;
    dayLinks.forEach(link => {
      const ids = link.dataset.ids.trim().split(/\s+/);
      const done = ids.filter(id => completed.has(id)).length;
      link.querySelector('progress').value = done;
      link.querySelector('[data-day-count]').textContent = `${done} / ${ids.length}`;
      total += ids.length;
      count += done;
    });
    root.querySelector('[data-course-progress]').textContent = `${count} / ${total} 학습 완료`;
    root.querySelector('[data-course-meter]').value = count;
  }

  const cards = [...root.querySelectorAll('.study-card')];
  function refreshProgress() {
    completed = readProgress();
    updateOverview();
    if (cards.length) update();
  }
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === key || event.key.startsWith(itemPrefix)) refreshProgress();
  });
  window.addEventListener('pageshow', refreshProgress);
  window.addEventListener('focus', refreshProgress);
  updateOverview();
  if (!cards.length) return;
  const search = root.querySelector('[data-search]');
  const tier = root.querySelector('select[data-tier]');
  const pending = root.querySelector('[data-pending]');
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase().trim();
  const searchText = new Map(cards.map(card => [card, normalize(card.textContent)]));

  function update() {
    const query = normalize(search.value);
    let visible = 0, done = 0;
    cards.forEach(card => {
      const isDone = completed.has(card.dataset.id);
      card.classList.toggle('is-done', isDone);
      card.querySelector('[data-done]').checked = isDone;
      done += isDone ? 1 : 0;
      card.hidden = !(searchText.get(card).includes(query)
        && (tier.value === 'all' || card.dataset.tier === tier.value)
        && (!pending.checked || !isDone));
      visible += card.hidden ? 0 : 1;
    });
    root.querySelector('[data-day-progress]').textContent = `${done} / ${cards.length} 학습 완료`;
    root.querySelector('[data-day-meter]').value = done;
    root.querySelector('[data-visible-count]').textContent = `${visible}개 표시`;
    root.querySelector('[data-empty]').hidden = visible !== 0;
  }

  cards.forEach(card => {
    card.querySelector('[data-done-control]').hidden = false;
    card.querySelector('[data-done]').addEventListener('change', event => {
      if (event.target.checked) completed.add(card.dataset.id);
      else completed.delete(card.dataset.id);
      try {
        // Independent keys prevent another day or stale tab from erasing progress.
        localStorage.setItem(itemPrefix + card.dataset.id, event.target.checked ? '1' : '0');
        completed = readProgress();
      } catch { warn(); }
      update();
    });
  });
  root.querySelector('[data-toolbar]').hidden = false;
  search.addEventListener('input', update);
  tier.addEventListener('change', update);
  pending.addEventListener('change', update);
  const toggle = root.querySelector('[data-toggle-examples]');
  function syncExampleButton() {
    const shown = cards.filter(card => !card.hidden);
    const allOpen = shown.length > 0 && shown.every(card => card.querySelector('[data-example]').open);
    toggle.textContent = allOpen ? '예문 모두 접기' : '예문 모두 펼치기';
  }
  toggle.addEventListener('click', () => {
    const shown = cards.filter(card => !card.hidden);
    const open = !shown.every(card => card.querySelector('[data-example]').open);
    shown.forEach(card => { card.querySelector('[data-example]').open = open; });
    syncExampleButton();
  });
  root.querySelectorAll('[data-example]').forEach(detail => detail.addEventListener('toggle', syncExampleButton));
  [search, tier, pending].forEach(control => control.addEventListener(control === search ? 'input' : 'change', syncExampleButton));
  update();
})();
