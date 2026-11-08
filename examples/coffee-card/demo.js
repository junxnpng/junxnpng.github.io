(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const seed = JSON.parse($('seed').textContent);
  const clone = value => JSON.parse(JSON.stringify(value));
  const seedCard = seed.card;
  const stateFile = 'saymore-coffee.json';
  const reviewFile = 'review-state.json';
  const noteFile = 'coffee.md';
  let card = clone(seedCard);
  let review = { cardId: 'coffee-picture-to-word', count: 0, history: [], due: null };
  let folder = null;
  let lastStateText = null;
  let lastReviewText = null;
  let dirty = false;
  let busy = false;
  let revealed = false;
  let graded = false;
  let practiceOnly = false;
  let assets = { image: dataBlob(seed.image), audio: dataBlob(seed.audio) };
  let previewURLs = [];
  const allowedMedia = /^media\/(?:coffee\.(?:jpg|mp3)|[0-9a-f-]+\.(?:jpg|png|webp|mp3))$/;

  function dataBlob(uri) {
    const [header, data] = uri.split(',');
    return new Blob([Uint8Array.from(atob(data), char => char.charCodeAt(0))], { type: header.match(/data:([^;]+)/)[1] });
  }
  function notice(message, error = false) {
    $('notice').hidden = !message;
    $('notice').textContent = message;
    $('notice').classList.toggle('error', error);
  }
  function formatDate(value) {
    if (!value) return '아직 학습 전';
    return new Intl.DateTimeFormat('ko-KR', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(new Date(value));
  }
  function refresh() {
    for (const url of previewURLs) URL.revokeObjectURL(url);
    previewURLs = [URL.createObjectURL(assets.image), URL.createObjectURL(assets.audio)];
    $('photo').src = previewURLs[0];
    $('audio').src = previewURLs[1];
    $('photo-credit').textContent = card.imageCredit;
    $('word').textContent = card.word;
    $('ipa').textContent = card.ipa;
    $('sentence').textContent = card.sentence;
    $('sentence').hidden = !card.sentence;
    $('memory').textContent = card.memory;
    $('memory').hidden = !card.memory;
    $('question').hidden = revealed;
    $('answer').hidden = !revealed;
    $('grades').hidden = graded || practiceOnly;
    $('complete').hidden = !graded && !practiceOnly;
    $('review-count').textContent = `${review.count}회`;
    $('next-review').textContent = formatDate(review.due);
    $('save').hidden = !folder;
    $('save').textContent = dirty ? '변경 내용 저장' : '파일에 저장됨';
    $('save').disabled = busy || !dirty;
    $('connect').disabled = busy;
    $('edit').disabled = busy;
    for (const el of document.querySelectorAll('[data-grade]')) el.disabled = busy;
    $('connection-label').textContent = folder ? `${folder.name} 연결됨` : '연습 모드';
    $('connection-dot').classList.toggle('connected', Boolean(folder));
    $('connect').textContent = folder ? '다른 폴더 연결' : '옵시디언 폴더 연결';
    $('storage-copy').textContent = folder ? '카드 내용은 coffee.md, 복습 기록은 review-state.json에 저장해요. 옵시디언에서도 노트를 열어볼 수 있어요.' : '지금은 이 탭에서만 연습 중이에요. 옵시디언 안의 예시 폴더를 연결하면 카드와 복습 기록을 파일로 저장해요.';
  }
  async function fileHandle(dir, name, create = false) {
    const parts = name.split('/');
    if (parts.length > 2 || parts.some(part => !part || part === '..' || part === '.')) throw Error('지원하지 않는 파일 경로입니다.');
    if (parts.length === 2) dir = await dir.getDirectoryHandle(parts.shift(), { create });
    return dir.getFileHandle(parts[0], { create });
  }
  async function readText(dir, name) {
    try { return await (await (await fileHandle(dir, name)).getFile()).text(); }
    catch (error) { if (error.name === 'NotFoundError') return null; throw error; }
  }
  async function writeFile(dir, name, value) {
    const writable = await (await fileHandle(dir, name, true)).createWritable();
    try { await writable.write(value); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch {} throw error; }
  }
  async function resolveStudyFolder(selected) {
    if (await readText(selected, stateFile) !== null) return selected;
    let containsFiles = false;
    for await (const _entry of selected.values()) { containsFiles = true; break; }
    if (!containsFiles) return selected;
    const parent = selected.name === 'SayMore' ? selected : await selected.getDirectoryHandle('SayMore', { create:true });
    const study = await parent.getDirectoryHandle('coffee-예시', { create:true });
    if (await readText(study, stateFile) === null) {
      for await (const _entry of study.values()) throw Error('coffee-예시 폴더에 다른 파일이 있어요. 빈 폴더를 선택해주세요. 기존 파일은 변경하지 않았어요.');
    }
    return study;
  }
  function parseCard(text) {
    const state = JSON.parse(text);
    if (state.format !== 'saymore-coffee-example' || state.version !== 1 || state.card?.id !== seedCard.id) throw Error('이 예시에서 사용할 수 없는 카드 파일입니다.');
    for (const key of ['word','ipa','sentence','memory','imagePath','audioPath','imageCredit','audioCredit']) {
      if (typeof state.card[key] !== 'string' || state.card[key].length > 2000) throw Error('카드 내용의 형식을 확인해주세요.');
    }
    if (state.card.word !== 'coffee' || state.card.ipa !== seedCard.ipa || !allowedMedia.test(state.card.imagePath) || !allowedMedia.test(state.card.audioPath)) throw Error('카드의 단어 또는 첨부파일 경로가 맞지 않습니다.');
    return state.card;
  }
  function parseReview(text) {
    if (!text) throw Error('복습 기록 파일이 없습니다. 기존 파일을 확인해주세요.');
    const value = JSON.parse(text);
    if (value.cardId !== 'coffee-picture-to-word' || !Number.isInteger(value.count) || value.count < 0 || !Array.isArray(value.history) || value.count !== value.history.length || value.history.length > 10000 || (value.due !== null && !Number.isFinite(Date.parse(value.due)))) throw Error('복습 기록의 형식을 확인해주세요.');
    return value;
  }
  // Only the generated block is replaced; extra Obsidian notes below it survive.
  function makeMarkdown(previous = '') {
    const safe = text => text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const block = `<!-- saymore:card:start -->\n# coffee\n\n${card.ipa} · 미국식\n\n![학습 사진](${card.imagePath})\n\n![[${card.audioPath}]]\n\n## 예문\n${safe(card.sentence)}\n\n## 나의 기억\n${safe(card.memory)}\n\n## 연습 방법\n사진을 보고 coffee를 소리 내어 말한 뒤, 음성을 듣고 확인합니다.\n복습 날짜와 결과는 같은 폴더의 review-state.json에 저장합니다.\n\n## 출처\n${safe(card.imageCredit)}\n\n${safe(card.audioCredit)}\n\n- 사진 원본: https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG\n- 음성 원본: https://commons.wikimedia.org/wiki/File:En-us-coffee.ogg\n- 사진 라이선스: https://creativecommons.org/licenses/by-sa/2.0/\n- 음성 라이선스: https://creativecommons.org/licenses/by-sa/3.0/\n- 발음 참고: https://en.wiktionary.org/wiki/coffee#Pronunciation\n\n사진·음성을 직접 교체하면 해당 파일의 출처가 적용됩니다. 기본 사진은 원본 그대로, 기본 음성은 Wikimedia MP3 변환본입니다.\n<!-- saymore:card:end -->`;
    const start = '<!-- saymore:card:start -->', end = '<!-- saymore:card:end -->';
    if (!previous) return `${block}\n\n## 추가 메모\n이 아래에는 옵시디언에서 자유롭게 메모해도 됩니다.\n`;
    const a = previous.indexOf(start), b = previous.indexOf(end);
    if (a < 0 || b < a || previous.indexOf(start, a + start.length) >= 0 || previous.indexOf(end, b + end.length) >= 0) throw Error('coffee.md의 예시 영역을 찾지 못했어요. 노트를 덮어쓰지 않았습니다.');
    return previous.slice(0, a) + block + previous.slice(b + end.length);
  }
  function explainError(error) {
    if (error.name === 'AbortError') return '폴더 연결을 취소했어요. 연습 내용은 이 탭에 남아 있어요.';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return '폴더 쓰기 권한이 필요해요. Chrome 또는 Edge에서 폴더를 다시 연결해주세요.';
    return error.message || '저장하지 못했어요. 폴더의 접근 권한과 남은 공간을 확인해주세요.';
  }
  async function save() {
    if (!folder || busy) return;
    busy = true; refresh();
    try {
      if (await readText(folder, stateFile) !== lastStateText || await readText(folder, reviewFile) !== lastReviewText) throw Error('다른 창에서 카드나 복습 기록이 바뀌었어요. 덮어쓰지 않았습니다. 폴더를 다시 연결해주세요.');
      const previousNote = await readText(folder, noteFile);
      const nextNote = makeMarkdown(previousNote || '');
      const stateText = JSON.stringify({ format:'saymore-coffee-example', version:1, card }, null, 2) + '\n';
      const reviewText = JSON.stringify(review, null, 2) + '\n';
      await writeFile(folder, card.imagePath, assets.image);
      await writeFile(folder, card.audioPath, assets.audio);
      await writeFile(folder, noteFile, nextNote);
      await writeFile(folder, stateFile, stateText);
      lastStateText = stateText;
      await writeFile(folder, reviewFile, reviewText);
      lastReviewText = reviewText;
      dirty = false;
      $('saved-at').textContent = formatDate(new Date().toISOString());
      notice('옵시디언 폴더에 저장했어요. coffee.md와 복습 기록을 확인할 수 있어요.');
    } catch (error) { notice(explainError(error), true); }
    finally { busy = false; refresh(); }
  }
  async function connect() {
    if (busy) return;
    if (typeof window.showDirectoryPicker !== 'function') { notice('폴더 저장은 맥의 Chrome 또는 Edge에서 사용할 수 있어요.', true); return; }
    // The picker must be called directly from this click, before asynchronous work.
    let selected;
    try { selected = await window.showDirectoryPicker({ id:'saymore-coffee', mode:'readwrite', startIn:'documents' }); }
    catch (error) { notice(explainError(error), error.name !== 'AbortError'); return; }
    busy = true; refresh();
    try {
      selected = await resolveStudyFolder(selected);
      const text = await readText(selected, stateFile);
      let nextCard = card, nextReview = review, nextAssets = assets, reviewText = null;
      if (text !== null) {
        nextCard = parseCard(text);
        reviewText = await readText(selected, reviewFile);
        nextReview = parseReview(reviewText);
        nextAssets = {};
        for (const type of ['image','audio']) {
          const file = await (await fileHandle(selected, nextCard[`${type}Path`])).getFile();
          nextAssets[type] = new Blob([await file.arrayBuffer()], { type:file.type });
        }
        if (dirty && !window.confirm('이 폴더에 저장된 예시 카드를 불러올까요? 이 탭에서 아직 저장하지 않은 연습 내용은 바뀝니다.')) return;
      } else {
        for await (const _entry of selected.values()) throw Error('제공된 coffee-예시 폴더 또는 비어 있는 새 폴더를 선택해주세요. 기존 파일은 변경하지 않았어요.');
      }
      folder = selected; lastStateText = text; lastReviewText = reviewText;
      card = nextCard; review = nextReview; assets = nextAssets;
      dirty = text === null; revealed = false; graded = false; practiceOnly = false;
      $('saved-at').textContent = text === null ? '아직 저장 전' : '저장된 파일 불러옴';
      notice(text === null ? '빈 폴더를 연결했어요. “변경 내용 저장”을 누르면 예시 파일이 만들어져요.' : '옵시디언 폴더의 카드와 복습 기록을 불러왔어요.');
    } catch (error) { notice(explainError(error), true); }
    finally { busy = false; refresh(); }
  }
  $('connect').addEventListener('click', connect);
  $('save').addEventListener('click', save);
  $('reveal').addEventListener('click', () => { revealed = true; refresh(); $('play').focus(); });
  $('play').addEventListener('click', async () => {
    try { $('audio').currentTime = 0; await $('audio').play(); }
    catch { notice('음성을 재생하지 못했어요. MP3 파일을 확인해주세요.', true); }
  });
  for (const button of document.querySelectorAll('[data-grade]')) button.addEventListener('click', async () => {
    if (busy || graded || !revealed || practiceOnly) return;
    const intervals = { again:10*60*1000, good:24*60*60*1000, easy:3*24*60*60*1000 };
    const now = new Date(), due = new Date(now.getTime() + intervals[button.dataset.grade]).toISOString();
    review = { ...review, count:review.count+1, due, history:[...review.history,{ at:now.toISOString(), grade:button.dataset.grade, due }] };
    graded = true; dirty = true;
    $('complete-text').textContent = `다음 복습: ${formatDate(due)}`;
    refresh();
    if (folder) await save();
    else notice('복습을 체험했어요. 아직 파일에는 저장하지 않았어요. 빈 학습 폴더를 연결하면 저장할 수 있어요.');
  });
  $('practice-again').addEventListener('click', () => { practiceOnly = true; revealed = false; $('complete-text').textContent = '기록을 바꾸지 않는 연습이에요.'; refresh(); });
  $('edit').addEventListener('click', () => {
    $('edit-sentence').value = card.sentence; $('edit-memory').value = card.memory;
    $('edit-image').value = ''; $('edit-audio').value = ''; $('editor-error').hidden = true;
    $('editor').showModal();
  });
  $('cancel-edit').addEventListener('click', () => $('editor').close());
  $('edit-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const nextCard = { ...card, sentence:$('edit-sentence').value.trim(), memory:$('edit-memory').value.trim() };
      const nextAssets = { ...assets };
      for (const type of ['image','audio']) {
        const file = $(`edit-${type}`).files[0];
        if (!file) continue;
        if (file.size > 10*1024*1024 || file.size === 0) throw Error('첨부파일은 0바이트보다 크고 10MB 이하인 파일을 골라주세요.');
        const mimeExtensions = { 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/mpeg':'mp3' };
        const extension = mimeExtensions[file.type];
        if (!extension || (type === 'audio' ? extension !== 'mp3' : extension === 'mp3')) throw Error('사진은 JPG·PNG·WebP, 음성은 MP3를 선택해주세요.');
        nextAssets[type] = file;
        nextCard[`${type}Path`] = `media/${crypto.randomUUID()}.${extension}`;
        nextCard[`${type}Credit`] = `직접 선택한 ${type === 'image' ? '사진' : '음성'} · ${file.name}`;
      }
      card = nextCard; assets = nextAssets; dirty = true;
      revealed = false; graded = false; practiceOnly = Boolean(review.count);
      $('complete-text').textContent = '기록을 바꾸지 않는 연습이에요.';
      $('editor').close(); refresh();
      if (folder) await save(); else notice('카드에 적용했어요. 폴더를 연결하기 전에는 이 탭에서만 유지돼요.');
    } catch (error) { $('editor-error').textContent = explainError(error); $('editor-error').hidden = false; }
  });
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  if (typeof window.showDirectoryPicker !== 'function') $('support').textContent = '연습은 이 브라우저에서도 가능해요. 폴더 저장은 맥의 Chrome 또는 Edge를 사용해주세요.';
  else $('support').textContent = '보관함을 선택하면 SayMore/coffee-예시 폴더를 사용해요. 예시 폴더를 바로 선택해도 돼요.';
  refresh();
})();
