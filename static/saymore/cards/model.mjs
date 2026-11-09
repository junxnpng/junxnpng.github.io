import {createEmptyCard, fsrs, generatorParameters} from './vendor/ts-fsrs.mjs';

export const copy = value => JSON.parse(JSON.stringify(value));
export const ratings = {1:'다시', 2:'어려움', 3:'알맞음', 4:'쉬움'};
const params = generatorParameters({request_retention:0.9, enable_fuzz:false});
const scheduler = fsrs(params);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mediaPath = /^media\/[0-9a-f-]{36}\.(jpg|png|webp|mp3)$/;
const metadata = {name:'FSRS-6', implementation:'ts-fsrs', version:'5.4.2', params};
const validDate = x => typeof x === 'string' && Number.isFinite(Date.parse(x));
const fail = message => { throw Error(message); };

export function newLibrary(now = new Date()) {
  return {format:'saymore-library', version:1, id:crypto.randomUUID(), revision:0,
    updatedAt:now.toISOString(), scheduler:copy(metadata), cards:[]};
}

function text(value, label, max = 4000) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) fail(`${label} 내용을 확인해주세요. 최대 ${max}자예요.`);
  return value.trim();
}

function media(value, kind) {
  if (!value) return null;
  const match = typeof value.path === 'string' && value.path.match(mediaPath);
  if (!match || !uuid.test(value.path.slice(6,42)) || (kind === 'audio' ? match[1] !== 'mp3' : match[1] === 'mp3')) fail('첨부파일 경로가 올바르지 않습니다.');
  return {path:value.path, credit:text(value.credit,'첨부파일 출처',1000)};
}

function normalize(fields) {
  if (!['picture','basic'].includes(fields.type)) fail('카드 종류를 선택해주세요.');
  const answer = text(fields.answer,'뒷면');
  if (!answer) fail('뒷면에 단어 또는 정답을 입력해주세요.');
  const front = text(fields.front,'앞면');
  const image = media(fields.image,'image'), audio = media(fields.audio,'audio');
  if (fields.type === 'picture' && !image) fail('그림 → 단어 카드에는 사진을 추가해주세요.');
  if (fields.type === 'basic' && !front && !image) fail('앞면에 질문 또는 사진을 넣어주세요.');
  const tags = Array.isArray(fields.tags) ? fields.tags : text(fields.tags,'태그',1000).split(/[\s,]+/);
  if (tags.length > 30 || tags.some(t=>typeof t !== 'string' || t.length > 60)) fail('태그는 30개 이하, 각각 60자 이하로 입력해주세요.');
  return {type:fields.type, deck:text(fields.deck,'덱',120) || '첫 100단어', front, answer,
    ipa:text(fields.ipa,'IPA',300), sentence:text(fields.sentence,'예문'), memory:text(fields.memory,'나의 기억'),
    tags:[...new Set(tags.map(t=>t.trim()).filter(Boolean))], image, audio,
    ...(fields.speech===undefined?{}:{speech:text(fields.speech,'합성 음성 문장',300)})};
}

export function newCard(fields, now = new Date()) {
  return {id:crypto.randomUUID(), ...normalize(fields), createdAt:now.toISOString(), updatedAt:now.toISOString(),
    schedule:copy(createEmptyCard(now)), reviews:[]};
}

export function editCard(card, fields, now = new Date()) {
  return {...copy(card), ...normalize(fields), updatedAt:now.toISOString()};
}

export function reviewOptions(card, now = new Date()) {
  const options = scheduler.repeat(copy(card.schedule), now);
  return Object.fromEntries([1,2,3,4].map(rating => [rating,{due:options[rating].card.due.toISOString()}]));
}

export function rateCard(card, rating, now = new Date()) {
  if (![1,2,3,4].includes(rating)) fail('답변을 선택해주세요.');
  if (Date.parse(card.schedule.due) > now.getTime()) fail('아직 복습 시간이 아니에요. 미리 보기로 연습할 수 있어요.');
  const result = scheduler.next(copy(card.schedule), now, rating);
  return {...copy(card), updatedAt:now.toISOString(), schedule:copy(result.card),
    reviews:[...copy(card.reviews), {at:now.toISOString(), rating, due:result.card.due.toISOString(), log:copy(result.log)}]};
}

export function dueCards(library, now = new Date(), deck = '') {
  return library.cards.filter(c => (!deck || c.deck === deck) && Date.parse(c.schedule.due) <= now.getTime())
    .sort((a,b) => Number(a.schedule.state === 0)-Number(b.schedule.state === 0) || Date.parse(a.schedule.due)-Date.parse(b.schedule.due));
}

export function parseLibrary(raw) {
  if (typeof raw !== 'string' || raw.length > 50 * 1024 * 1024) fail('카드 파일의 크기를 확인해주세요.');
  let lib;
  try { lib = JSON.parse(raw); } catch { fail('library.json을 읽지 못했어요. 원본 파일과 library.backup.json을 확인해주세요.'); }
  if (!lib || lib.format !== 'saymore-library' || lib.version !== 1 || !uuid.test(lib.id) || !Number.isInteger(lib.revision) || lib.revision < 0 || !validDate(lib.updatedAt) || !Array.isArray(lib.cards) || lib.cards.length > 10000) fail('지원하지 않는 카드 보관함 형식입니다. 기존 파일을 변경하지 않았어요.');
  if (JSON.stringify(lib.scheduler) !== JSON.stringify(metadata)) fail('이 보관함의 복습 설정은 현재 버전에서 지원하지 않습니다.');
  const ids = new Set();
  for (const card of lib.cards) {
    if (!card || !uuid.test(card.id) || ids.has(card.id) || !validDate(card.createdAt) || !validDate(card.updatedAt)) fail('카드 식별자 또는 날짜를 확인해주세요.');
    ids.add(card.id);
    const fields=normalize(card);
    for (const [key,value] of Object.entries(fields)) {
      if (JSON.stringify(card[key]) !== JSON.stringify(value)) fail('카드 입력 항목의 형식을 확인해주세요.');
    }
    const s = card.schedule;
    if (!s || !validDate(s.due) || ![0,1,2,3].includes(s.state) || (s.last_review !== undefined && !validDate(s.last_review))) fail('카드의 복습 날짜를 확인해주세요.');
    for (const k of ['stability','difficulty','elapsed_days','scheduled_days','learning_steps','reps','lapses']) {
      if (!Number.isFinite(s[k]) || s[k] < 0 || s[k] > 1e9) fail('카드의 복습 상태를 확인해주세요.');
    }
    if (![s.reps,s.lapses,s.learning_steps].every(Number.isInteger) || s.difficulty > 10 || !Array.isArray(card.reviews) || card.reviews.length !== s.reps || card.reviews.length > 10000) fail('복습 횟수와 기록이 일치하지 않습니다.');
    for (const r of card.reviews) {
      if (!r || !validDate(r.at) || !validDate(r.due) || ![1,2,3,4].includes(r.rating)) fail('복습 기록의 날짜 또는 답변을 확인해주세요.');
    }
  }
  return lib;
}

export function dateLabel(value) {
  return new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
}

export function intervalLabel(value, now = new Date()) {
  const minutes = Math.max(1,Math.round((Date.parse(value)-now.getTime())/60000));
  if (minutes < 60) return `${minutes}분 후`;
  if (minutes < 1440) return `${Math.round(minutes/60)}시간 후`;
  return `${Math.round(minutes/1440)}일 후`;
}

const escapeMD = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/([\\`*_{}\[\]()#!|])/g,'\\$1');
export function renderNote(card, previous = '') {
  const start = '<!-- saymore:card:start -->', end = '<!-- saymore:card:end -->';
  const lines = [start,`# ${escapeMD(card.answer.replace(/\n/g,' '))}`,'',`덱: ${escapeMD(card.deck)} · ${card.type === 'picture' ? '그림 → 단어' : '앞면 → 뒷면'}`,'',
    '## 앞면',escapeMD(card.front) || '사진을 보고 영어로 말해보세요.',''];
  if (card.image) lines.push(`![학습 사진](../${card.image.path})`,'',escapeMD(card.image.credit),'');
  lines.push('## 뒷면',escapeMD(card.answer),'',escapeMD(card.ipa),'');
  if (card.audio) lines.push(`![[${card.audio.path.slice(6)}]]`,'',escapeMD(card.audio.credit),'');
  if (card.speech) lines.push(`미국식 기기 합성 음성: ${escapeMD(card.speech)}`,'');
  if (card.sentence) lines.push('## 예문',escapeMD(card.sentence),'');
  if (card.memory) lines.push('## 나의 기억',escapeMD(card.memory),'');
  if (card.tags.length) lines.push(`태그: ${card.tags.map(escapeMD).join(' · ')}`,'');
  lines.push('## 복습',`- 다음 복습: ${dateLabel(card.schedule.due)} (${card.schedule.due})`,`- 기록한 복습: ${card.reviews.length}회`,'');
  if (card.reviews.length) {
    lines.push('최근 복습 기록:');
    for (const r of card.reviews.slice(-20).reverse()) lines.push(`- ${dateLabel(r.at)} · ${ratings[r.rating]} · 다음 ${dateLabel(r.due)}`);
    lines.push('');
  }
  lines.push('카드 내용과 일정은 Say More에서 수정합니다. 아래 추가 메모는 자유롭게 적어도 됩니다.',end);
  const block = lines.join('\n');
  if (!previous) return `${block}\n\n## 추가 메모\n\n`;
  const a = previous.indexOf(start), b = previous.indexOf(end);
  if (a < 0 || b < a || previous.indexOf(start,a+start.length) !== -1 || previous.indexOf(end,b+end.length) !== -1) fail('기존 노트의 카드 영역을 찾지 못했어요. 노트를 덮어쓰지 않았습니다.');
  return previous.slice(0,a)+block+previous.slice(b+end.length);
}
