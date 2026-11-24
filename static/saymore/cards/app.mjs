import {newCard, editCard, rateCard, correctLastReview, reviewOptions, dueCards, dateLabel, intervalLabel, ratings, overdueMs, reviewLateMs, waitLabel} from './model.mjs?v=9';
import {studyGroups,cardsInGroup,studyQueue,studyProgress,sortCards,sortOrders,reviewOrders,resumeIndex,unseenFirst,setSection,inSection,sections,levelSummary} from './study-groups.mjs?v=19';
import {FolderStore, rememberedFolder, friendlyError} from './storage.mjs?v=9';
import {el, showCard} from './view.mjs?v=19';
import {DropboxStore} from './dropbox-store.mjs?v=14';
import {readSnapshot,writeSnapshot,clearSnapshot} from './snapshot-cache.mjs?v=1';
import {MediaCache} from './media-cache.mjs?v=1';
import {parseBundle} from './bundle.mjs?v=2';
import {prepareImagePatch,prepareAudioPatch,prepareTextPatch,patchKind} from './image-patch.mjs?v=16';
import {openDropbox} from '../shared/dropbox.mjs?v=8';
import {flagKinds,hasFlag,setFlag,pictureMark,memoryQuestion,memoryTags,hasHangul} from './image-flag.mjs?v=6';
import {setSetting,syncSettings,settingKeys} from '../shared/sync.mjs?v=4';

const $=id=>document.getElementById(id);
let store=null, cachedFolder=null, view='library', busy=false, dirty=false, editedId=null, previewBack=false;
let draftMedia={image:null,audio:null}, activeCard=null, revealed=false, sessionCount=0, unknownSession=null, detailCard=null, detailBack=false;
let connectionEpoch=0, reviewRequest=0, noticeVersion=0, lastSaved='', draftURLs=new Set();
const mediaCache=new MediaCache(path=>store.readMedia(path));
const inputs=['front','answer','ipa','speech','sentence','memory','tags'];
const supported=typeof window.showDirectoryPicker==='function';
let cloud=null,refreshing=false;
let selectedGroup='all',practiceIndex=0,practiceOrder=[],practiceGroup=null;
let sortOrder='default', lastGraded=null, lastListKey='';
let cameToReview=location.hash==='#review';
// Settings that decide what the review shows (the chosen group, where practice stopped,
// the list order) are shared through Dropbox, so the phone and the computer start from the same card.
// Each change is saved here at once with its time and sent to Dropbox a moment later; see shared/sync.mjs.
let shareTimer=null,sharing=null,shareAgain=false,forceNext=false;
function shareSoon(ms=2000){clearTimeout(shareTimer);shareTimer=setTimeout(()=>void shareSettings(),ms);}
// One sync at a time; a change made while one runs is sent by one more round right after it.
async function shareSettings(options={}){
  if(store?.kind!=='dropbox'||!cloud?.connected)return;
  if(sharing){shareAgain=true;if(options.force)forceNext=true;return sharing;}
  sharing=(async()=>{
    try{do{shareAgain=false;const force=Boolean(options.force||forceNext);forceNext=false;const changed=await syncSettings(cloud);if(changed.length)applySettings(changed,{...options,force});}while(shareAgain);}
    catch{/* This browser's settings hold; the next change or visit tries again. */}
    finally{sharing=null;}
  })();
  return sharing;
}
// Settings changed on another device (or another tab) are taken over here. A review under way keeps its
// group until its card is answered; `force` is for loading, before anything is drawn.
let pendingGroup=false;
function applySettings(changed,{redraw=true,force=false}={}){
  try{const saved=localStorage.getItem('saymore.cards.sort.v1');if(Object.hasOwn(sortOrders,saved||''))sortOrder=saved;$('sort-order').value=sortOrder;}catch{/* Unchanged. */}
  let groupChanged=false;
  if((changed.includes(groupKey)||pendingGroup)&&(force||(!busy&&!(view==='review'&&activeCard)))){
    pendingGroup=false;
    let next=selectedGroup;try{next=localStorage.getItem(groupKey)||'all';}catch{/* Unchanged. */}
    groupChanged=next!==selectedGroup;selectedGroup=next;
  }else if(changed.includes(groupKey))pendingGroup=true;
  let modeChanged=false;
  if(changed.includes(modeKey)&&!isPractice()&&!unknownSession&&(force||(!busy&&!(view==='review'&&activeCard)))){
    const next=savedMode();modeChanged=next!==$('review-mode').value;$('review-mode').value=next;
  }
  if(changed.includes(orderKey)&&(force||(!busy&&!(view==='review'&&activeCard)))){
    const next=savedOrder();if(next!==$('review-order').value){$('review-order').value=next;if($('review-mode').value==='due'&&!unknownSession)modeChanged=true;}
  }
  if(!redraw||busy)return;
  updateDecks();updateStats();controls();
  if(view==='library')renderLibrary();
  else if(view==='review'&&!activeCard){if(groupChanged||modeChanged)startReview(unknownSession!==null);else void showNextReview();}
}
try{const saved=localStorage.getItem('saymore.cards.sort.v1');if(Object.hasOwn(sortOrders,saved||''))sortOrder=saved;}catch{/* Sorting still works for this visit. */}
// The same page serves four tabs: word cards, and with ?set=form, ?set=order or ?set=work the cards of that tab alone.
// Dropbox sends the reader back to the bare address, so the tab they left from is kept across the sign-in.
const returnKey='saymore.cards.auth-set.v1';
const arrived=new URLSearchParams(location.search);
let askedSet=arrived.get('set');
try{if(!askedSet&&(arrived.has('code')||arrived.has('error')))askedSet=sessionStorage.getItem(returnKey);sessionStorage.removeItem(returnKey);}catch{/* The word-card tab opens instead. */}
const section=setSection(askedSet);
// Dropbox's sign-in strips the address down; put the tab back so a reload opens the same one.
// Only after openDropbox(), which reads the sign-in code from the address first.
function keepSet(){if(section!=='cards'&&!new URLSearchParams(location.search).has('set'))history.replaceState(null,'',`${location.pathname}?set=${section}${location.hash}`);}
const groupKey=section==='cards'?'saymore.cards.group.v1':`saymore.cards.group.${section}.v1`;
const positionKey=section==='cards'?'saymore.cards.practice-position.v1':`saymore.cards.practice-position.${section}.v1`;
// The rated way of reviewing chosen last (오늘 복습 or 안 본 카드만), shared like the group. Practice is never
// remembered: the page opens with the rating buttons.
const modeKey=section==='cards'?'saymore.cards.review-mode.v2':`saymore.cards.review-mode.${section}.v2`;
const ratedModes=['due','unseen'];
const savedMode=()=>{try{const value=localStorage.getItem(modeKey);return ratedModes.includes(value)?value:'due';}catch{return 'due';}};
// The order of 오늘 복습 in this tab (reviewOrders), shared the same way.
const orderKey=section==='cards'?'saymore.cards.review-order.v1':`saymore.cards.review-order.${section}.v1`;
const savedOrder=()=>{try{const value=localStorage.getItem(orderKey);return Object.hasOwn(reviewOrders,value||'')?value:'dueFirst';}catch{return 'dueFirst';}};
try{selectedGroup=localStorage.getItem(groupKey)||'all';}catch{/* Selection is optional when browser storage is unavailable. */}

function notice(message,error=false){noticeVersion++;$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
// While an answer is being saved the review continues on the cards as they will be once it is stored.
let saving=false, pendingCards=null;
function cards(){return pendingCards || store?.library.cards || [];}
function controls(){
  for(const button of document.querySelectorAll(view==='library'?'button':'button:not(#card-list button)'))button.disabled=busy;
  for(const input of $('card-form').querySelectorAll('input,textarea,select'))input.disabled=busy;
  $('memory-text').disabled=busy;
  $('connect').disabled=busy||!supported;
  $('save-next').disabled=$('save-list').disabled=busy||!store;
  $('save-next').hidden=Boolean(editedId);
  const online=store?.kind==='dropbox';
  $('connect-dropbox').textContent=cloud?.connected?'Dropbox 다시 읽기':'Dropbox 연결';
  $('disconnect-dropbox').hidden=!cloud?.connected;
  $('import-folder-label').hidden=!online;
  $('import-folder').disabled=busy;
  $('bundle-panel').hidden=!online;
  $('bundle-data').disabled=busy;
  $('image-bundle-file').disabled=busy;
  $('import-bundle').disabled=$('append-bundle').disabled=busy||!online;
  for(const id of ['deck-filter','review-group','review-mode','review-order','level-summary-open'])$(id).disabled=busy;
  $('practice-previous').disabled=busy||practiceIndex===0;
  $('practice-next').disabled=busy||!activeCard;
  $('save-help').textContent=store ? `저장하면 카드와 복습 일정이 ${online?'Dropbox':'선택한 폴더'}에 남아요.` : '먼저 위의 Dropbox 연결을 눌러주세요. 입력한 내용은 그대로 남아요.';
  for(const button of document.querySelectorAll('[data-rating]'))button.disabled=busy||saving;
  flagControl();
  $('reload').hidden=!store;
  $('connection').textContent=online ? 'Dropbox 연결됨' : store ? `${store.folder.name} 폴더 연결됨` : '저장소 연결 전';
  $('connection').classList.toggle('connected',Boolean(store));
  $('connect').textContent=store&&store.kind!=='dropbox' ? '다른 폴더 연결':'로컬 폴더 연결';
  $('storage-copy').textContent=store ? `카드·복습 날짜·전체 기록을 ${online?'Dropbox 전용 폴더':'선택한 폴더'}에 저장해요.${lastSaved ? ' 마지막 저장 '+lastSaved : ''}` : '같은 Dropbox 계정을 연결하면 아이폰과 맥에서 이어서 공부할 수 있어요.';
  retryControls();
}
function retryControls(){
  const count=store?studyQueue(cards(),selectedGroup,'unknown').length:0,practice=isPractice();
  $('review-unknown').hidden=practice||!count||Boolean(unknownSession&&activeCard);
  $('review-unknown').textContent=`모름 다시 보기 · ${count}장`;
  $('review-normal').hidden=practice||unknownSession===null;
  $('review-normal').textContent=savedMode()==='unseen'?'안 본 카드만으로':'오늘 복습으로';
  $('fix-last').hidden=practice||!lastGraded||!cards().some(c=>c.id===lastGraded.id);
  if(lastGraded)$('fix-last').textContent=`← 방금 평가 고치기 · ${lastGraded.answer.slice(0,12)} (${ratings[lastGraded.rating]})`;
  $('unknown-help').hidden=practice||!count;
  $('review-title').textContent=practice?'자유 연습':unknownSession?'모름 다시 보기':unseenOnly()?'안 본 카드만':'오늘 복습';
  const groups=studyGroups(cards()),now=new Date();
  for(const id of ['deck-filter','review-group'])for(const option of $(id).options){
    const group=groups.find(g=>g.key===option.value);if(group)option.textContent=groupLabel(group,now);
  }
  const group=groups.find(g=>g.key===selectedGroup),progress=studyProgress(group?.cards||[],now);
  const dueMode=$('review-mode').value==='due'&&!unknownSession;
  $('review-order-label').hidden=!dueMode;
  $('review-settings-now').textContent=store?`${group?.label||''} · ${$('review-mode').selectedOptions[0]?.textContent.split(' · ')[0]||''}${dueMode&&unseenFirstOrder()?` · ${reviewOrders.unseenFirst}`:''}`:'';
  $('rating-help').textContent=practice?'평가는 해도 되고 안 해도 돼요. 잘못 누른 평가는 ‘카드 목록’ 탭에서 그 카드의 ‘평가 고치기’로 고쳐요.':'모름 카드는 24시간 안에 다시 볼 수 있어요. 잘못 눌렀으면 ‘방금 평가 고치기’를 누르세요.';
  $('review-group-help').textContent=store?`전체 ${progress.total}장 · 지금 남음 ${progress.remaining}장 · 오늘 끝냄 ${progress.completedToday}장 · 나중에 ${progress.waiting}장`:section==='cards'?'Dropbox를 연결하면 등급별 단어 묶음(A1–B2)과 IPA 묶음을 고를 수 있어요.':'Dropbox를 연결하면 이 탭의 카드와 복습 날짜를 불러와요.';
  const rememberedId=practicePositions()[selectedGroup];
  const remembered=store&&cardsInGroup(cards(),selectedGroup).some(c=>c.id===rememberedId);
  const unseenLeft=store?studyQueue(cards(),selectedGroup,'unseen').length:0;
  $('review-mode-help').textContent=unseenOnly()?(unseenLeft?`이 묶음에서 아직 안 본 카드 ${unseenLeft}장만 차례로 나와요. 복습할 때가 된 카드는 나오지 않아요.`:'이 묶음에는 안 본 카드가 없어요.'):$('review-mode').value==='resume'?(remembered?'지난번에 멈춘 카드부터 봐요.':'기억해 둔 위치가 없어서 아직 안 본 첫 카드부터 봐요.')+' 평가는 해도 되고 안 해도 돼요.':practice?'날짜와 상관없이 묶음 전체를 봐요. 평가는 해도 되고 안 해도 돼요.':unseenFirstOrder()?'아직 안 본 카드 먼저, 그다음 복습할 때가 된 카드가 나와요.':'복습할 때가 된 카드 먼저, 그다음 아직 안 본 카드가 나와요.';
}
function isPractice(){return ['practice','resume'].includes($('review-mode').value);}
function unseenOnly(){return $('review-mode').value==='unseen'&&!unknownSession;}
function unseenFirstOrder(){return $('review-order').value==='unseenFirst';}
// Free practice remembers the card last shown in each group so "이어서 연습" can continue from it.
function practicePositions(){try{const value=JSON.parse(localStorage.getItem(positionKey));return value&&typeof value==='object'?value:{};}catch{return {};}}
// Practice shows cards never reviewed first. The order is fixed when practice starts, so a card that
// gets rated on the way does not jump behind the others and shift every position after it.
// For the same reason a card that leaves the group on the way (its "hear later" mark taken off) keeps its
// place until practice starts again; otherwise the card after it would slide back and be skipped.
function practiceCards(list=cards()){
  const inGroup=cardsInGroup(list,selectedGroup),known=new Set(practiceOrder);
  const byId=new Map((practiceGroup===selectedGroup?inSection(list):inGroup).map(c=>[c.id,c]));
  return [...practiceOrder.map(id=>byId.get(id)).filter(Boolean),...inGroup.filter(c=>!known.has(c.id))];
}
function practiceStart(){
  practiceGroup=selectedGroup;
  practiceOrder=store?unseenFirst(cardsInGroup(cards(),selectedGroup)).map(c=>c.id):[];
  return store&&$('review-mode').value==='resume'?resumeIndex(practiceCards(),practicePositions()[selectedGroup]):0;
}
function rememberPractice(cardId){const all=practicePositions();if(cardId)all[selectedGroup]=cardId;else delete all[selectedGroup];setSetting(positionKey,JSON.stringify(all));shareSoon(5000);}
function setBusy(value){busy=value;controls();}
function updateStats(){
  const mine=inSection(cards());
  $('total-count').textContent=mine.length;
  const toRemember=mine.filter(c=>hasFlag(c,'remember')).length;
  $('memory-tab').textContent=toRemember?`기억 만들기 · ${toRemember}`:'기억 만들기';
  $('new-count').textContent=mine.filter(c=>c.schedule.state===0).length;
  $('due-count').textContent=store ? inSection(dueCards(store.library)).filter(c=>c.schedule.state!==0).length : 0;
  // The home page shows today's count from these due dates without opening Dropbox itself.
  if(store)try{
    // Unseen cards (`fresh`) and the due dates of seen ones: the home page adds them up as what is left to do.
    const summary=list=>({total:list.length,fresh:list.filter(c=>c.schedule.state===0).length,due:list.filter(c=>c.schedule.state!==0).map(c=>Date.parse(c.schedule.due))});
    const counts={...summary(inSection(cards(),'cards')),sections:Object.fromEntries(Object.keys(sections).map(name=>[name,summary(inSection(cards(),name))]))};
    // Only a real change is recorded (and shared): drawing the page again must not look like news to other devices.
    const before=JSON.parse(localStorage.getItem('saymore.home.cards.v1')||'null');
    if(!before||JSON.stringify({...before,at:0})!==JSON.stringify({...counts,at:0})){setSetting('saymore.home.cards.v1',JSON.stringify({...counts,at:Date.now()}));shareSoon(20000);}
  }catch{/* The home page keeps its last numbers. */}
}
function groupLabel(group,now=new Date()){
  const p=studyProgress(group.cards,now);
  return `${group.label} · ${p.total}장 · 오늘 끝냄 ${p.completedToday} · 남음 ${p.remaining}`;
}
function updateDecks(){
  const decks=[...new Set(inSection(cards()).map(c=>c.deck))].sort((a,b)=>a.localeCompare(b));
  const groups=studyGroups(cards()),labelNow=new Date();
  if(!groups.some(g=>g.key===selectedGroup))selectedGroup='all';
  for(const id of ['deck-filter','review-group']){
    const select=$(id);select.replaceChildren();
    for(const section of [...new Set(groups.map(g=>g.section))]){
      const optgroup=el('optgroup');optgroup.label=section;
      for(const group of groups.filter(g=>g.section===section))optgroup.append(new Option(groupLabel(group,labelNow),group.key));
      select.append(optgroup);
    }
    select.value=selectedGroup;
  }
  $('known-decks').replaceChildren(...decks.map(d=>new Option(d,d)));
}
function chooseGroup(key){
  if(busy)return;
  selectedGroup=key;
  setSetting(groupKey,key);shareSoon();
  $('deck-filter').value=$('review-group').value=key;
  if(view==='review')startReview(unknownSession!==null);else renderLibrary();
}
// The marks under a review card: the picture does not fit the word, or the sentence, or there is no picture.
// They are offered on the back only, where the word and the sentence can be read against the picture; the
// front stays free of anything but the question.
// A mark shows at once and is saved with the answer that follows, in the same save, so marking a card costs
// no more waiting than answering it. A card left without an answer (next card in practice, another group or
// view, the page hidden) has its marks saved on their own at that moment.
let staged=null;   // {id, kinds: Map(kind -> on)}: marks shown on the card on screen and not yet saved
// Puts staged marks on a copy of `card` (the version on screen, or the latest saved one). A mark about the
// picture is left out when the picture it judged is no longer there (or has appeared) in that version.
function applyMarks(card,kinds){
  let out=card;
  for(const [kind,on] of kinds){
    if(on&&kind in pictureMark&&Boolean(out.image)!==pictureMark[kind])continue;
    if(hasFlag(out,kind)!==on)out=setFlag(out,kind,on);
  }
  return out;
}
function withStaged(card){
  if(!staged||!card||card.id!==staged.id)return card;
  try{return applyMarks(card,staged.kinds);}catch{return card;}
}
function flagControl(){
  const picture=Boolean(activeCard?.image);
  $('flag-row').hidden=!activeCard||!revealed;
  for(const button of $('flag-row').querySelectorAll('button')){
    const kind=button.dataset.flag,on=Boolean(activeCard&&hasFlag(activeCard,kind));
    button.hidden=kind==='remember'||kind==='listen'?false:kind==='awkward'?!activeCard?.sentence:kind==='missing'?picture:!picture||(kind==='sentence'&&!activeCard?.sentence);
    button.setAttribute('aria-pressed',String(on));button.textContent=flagKinds[kind][on?'on':'off'];
    button.disabled=busy||!store;
  }
}
function toggleFlag(kind){
  if(busy||!store||!activeCard||(kind in pictureMark&&Boolean(activeCard.image)!==pictureMark[kind]))return;
  if(staged&&staged.id!==activeCard.id)void flushStaged();
  let updated;
  try{updated=setFlag(activeCard,kind,!hasFlag(activeCard,kind));}catch(e){notice(friendlyError(e),true);return;}
  if(!staged)staged={id:updated.id,answer:updated.answer,kinds:new Map()};
  staged.kinds.set(kind,hasFlag(updated,kind));
  // The card on screen becomes the marked one, so an answer given next is recorded on top of it.
  activeCard=updated;flagControl();
  notice(`${hasFlag(updated,kind)?'표시했어요':'표시를 지웠어요'} · ${isPractice()?'다음 카드로 넘어가면 저장돼요.':'평가하면 함께 저장돼요.'}`);
}
// Saves marks left without an answer. It waits for any save under way in this window (store.commit allows
// one at a time) and puts the marks on the latest saved version of the card.
const lostMarks=answer=>`‘${answer.slice(0,40)}’ 카드의 표시는 저장되지 않았어요.`;
async function flushStaged(){
  const marks=staged;if(!marks)return;
  staged=null;
  while(saving||busy||store?.writing)await new Promise(resolve=>setTimeout(resolve,100));
  const owner=store,base=store?.library.cards.find(c=>c.id===marks.id);
  if(!owner||!base){notice(`${lostMarks(marks.answer)} 카드를 찾지 못했거나 연결이 끊겼어요.`,true);return;}
  let updated;
  try{updated=applyMarks(base,marks.kinds);}catch(e){notice(`${friendlyError(e)} ${lostMarks(base.answer)}`,true);return;}
  if(updated===base)return;
  const next=owner.library.cards.map(c=>c.id===updated.id?updated:c);
  // An error shown just before (a rating that was not saved) stays on screen; this success does not cover it.
  const errorShown=$('notice').classList.contains('error');
  saving=true;pendingCards=next;controls();
  try{
    const result=await owner.commit({...owner.library,cards:next},{},[updated.id],undefined,{deferNotes:true});
    pendingCards=null;saving=false;
    if(store===owner){
      if(errorShown){lastSaved=dateLabel(new Date().toISOString());updateStats();}
      else saved(result,`‘${updated.answer.slice(0,40)}’ 카드의 표시를 저장했어요.`,{review:true});
      const savedNotice=noticeVersion;
      const reportNotes=notes=>{if(store===owner)noteWarnings(notes,noticeVersion===savedNotice);};
      if(result.notes)void result.notes.then(reportNotes,error=>reportNotes({warnings:[{message:error.message}]}));
    }
  }catch(e){
    pendingCards=null;saving=false;
    if(store===owner){
      // The card shows its saved marks again, plus any mark made on it since.
      if(activeCard?.id===updated.id){activeCard=withStaged(store.library.cards.find(c=>c.id===updated.id)||activeCard);flagControl();}
      const clash=/다른 기기에서도 바뀌었어요/.test(e?.message||'');
      notice(`${friendlyError(e)} ${lostMarks(updated.answer)}`,true);
      if(clash)void refreshCloud();
    }
  }finally{
    controls();
    // Lists drawn while the save was waiting show the cards before it.
    if(store===owner){if(view==='memory')void showMemory();else if(view==='library')renderLibrary();}
  }
}
let listRest=[];
const listWatch='IntersectionObserver' in window?new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&listRest.length)appendRows();},{rootMargin:'600px'}):null;
function cardRow(c){
  const row=el('article',undefined,'card-row'), title=el('div');
  title.append(el('h3',c.answer),el('p',[c.ipa,c.deck,c.tags.map(t=>'#'+t).join(' ')].filter(Boolean).join(' · ')));
  const schedule=el('div',undefined,'row-schedule');
  const state=c.schedule.state===0?'새 카드':Date.parse(c.schedule.due)<=Date.now()?'복습할 시간':'다음 복습';
  const waited=waitLabel(overdueMs(c));
  schedule.append(el('span',state,'status'),el('span',c.schedule.state===0?'바로 학습할 수 있어요':dateLabel(c.schedule.due)),el('p',`복습 ${c.reviews.length}회${waited?` · 예정일에서 ${waited} 지남`:''}`));
  const actions=el('div',undefined,'row-actions'), preview=el('button','미리 보기','text-button'), edit=el('button','수정','text-button');
  // Read out of context, as in a list of buttons, each says which card it belongs to.
  preview.setAttribute('aria-label',`${c.answer} 미리 보기`);edit.setAttribute('aria-label',`${c.answer} 수정`);
  preview.addEventListener('click',()=>openDetail(c.id));edit.addEventListener('click',()=>openEdit(c.id));
  actions.append(preview,edit);
  if(c.reviews.at(-1)?.log){const fix=el('button','평가 고치기','text-button');fix.setAttribute('aria-label',`${c.answer} 평가 고치기`);fix.addEventListener('click',()=>openDetail(c.id,true));actions.append(fix);}
  row.append(title,schedule,actions);
  return row;
}
function appendRows(count=60){
  const fragment=document.createDocumentFragment();
  for(const c of listRest.splice(0,count))fragment.append(cardRow(c));
  $('card-list').append(fragment);
  $('list-more').hidden=!listRest.length;
  $('list-more').textContent=`더 보기 · 남은 ${listRest.length}장`;
}
// The memory page: the cards marked to remember, one at a time, with one question and a box for a memory.
// The memory goes in the card's own `memory` field, which the back of the card already shows.
const memorySkipped=new Set();let memoryCard=null,memoryRequest=0;
const memoryQueue=()=>inSection(cards()).filter(c=>hasFlag(c,'remember'));
async function showMemory(focus=false){
  const request=++memoryRequest,queue=memoryQueue();
  if(queue.length&&queue.every(c=>memorySkipped.has(c.id)))memorySkipped.clear();
  const keep=memoryCard&&queue.find(c=>c.id===memoryCard.id&&!memorySkipped.has(c.id));
  memoryCard=keep||queue.find(c=>!memorySkipped.has(c.id))||null;
  $('memory-progress').textContent=store?`남은 카드 ${queue.length}장`:'';
  $('memory-active').hidden=!memoryCard;$('memory-empty').hidden=Boolean(memoryCard);
  $('memory-empty-title').textContent=store?'따로 외울 단어가 없어요.':'Dropbox를 연결하면 표시한 카드가 보여요.';
  $('memory-error').hidden=true;
  if(!memoryCard){if(focus&&view==='memory')$('memory-empty-title').focus({preventScroll:true});return;}
  const card=memoryCard;
  if(!keep){$('memory-text').value=card.memory||'';}
  $('memory-question').textContent=memoryQuestion(card.answer);
  let urls={};try{urls=await sources(card,true);}catch{/* The card is shown without its picture. */}
  if(request!==memoryRequest||memoryCard!==card)return;
  showCard($('memory-card'),card,urls,true);
  if(focus)$('memory-text').focus({preventScroll:true});
}
async function saveMemory(event,{unmark=false}={}){
  event?.preventDefault();
  if(!store||!memoryCard)return;
  if(busy||saving){notice('앞의 저장이 끝난 뒤 다시 눌러 주세요.');return;}
  const text=$('memory-text').value.trim(),before=cards().find(c=>c.id===memoryCard.id);
  // The card is read again from the library: another device may have answered it meanwhile.
  if(!before||!hasFlag(before,'remember')){notice('이 카드는 다른 곳에서 바뀌어 목록에서 빠졌어요.');memoryCard=null;await showMemory(true);return;}
  if(!unmark&&!text){$('memory-error').textContent='떠오르는 것을 한 줄이라도 적어 주세요. 지금 떠오르지 않으면 ‘나중에 적기’를 누르세요.';$('memory-error').hidden=false;return;}
  if(!unmark&&hasHangul(text)){$('memory-error').textContent='카드에는 한글을 넣지 않아요. 영어나 이름으로 적어 주세요.';$('memory-error').hidden=false;return;}
  let updated;
  try{updated=unmark?setFlag(before,'remember',false):editCard(before,{...before,memory:text,tags:memoryTags(before)});}
  catch(e){$('memory-error').textContent=friendlyError(e);$('memory-error').hidden=false;return;}
  setBusy(true);
  try{
    const result=await store.commit({...store.library,cards:cards().map(c=>c.id===updated.id?updated:c)},{},[updated.id]);
    memoryCard=null;saved(result,unmark?`‘${updated.answer.slice(0,40)}’ 카드의 표시를 풀었어요.`:`‘${updated.answer.slice(0,40)}’ 카드에 기억을 저장했어요. 복습할 때 뒷면에 나와요.`,{review:true});
  }catch(e){$('memory-error').textContent=`${friendlyError(e)} 저장되지 않았어요.`;$('memory-error').hidden=false;}
  finally{setBusy(false);}
  if(!memoryCard)await showMemory(true);
}
// The word cards of each level, counted by their first answer. Only the word tab has levels.
function renderLevelSummary(){
  const rows=store&&section==='cards'?levelSummary(cards()):[];
  $('level-summary').hidden=!rows.some(r=>r.seen);
  if($('level-summary').hidden)return;
  const pct=(n,of)=>!of?'–':n&&n*100/of<1?'1% 미만':`${Math.round(n*100/of)}%`;
  const table=el('table'),head=el('tr');
  head.append(...['등급','전체','본 카드',...[1,2,3,4].map(r=>`처음 ${ratings[r]}`)].map(text=>{const th=el('th',text);th.scope='col';return th;}));
  table.createCaption().textContent='등급별 처음 답';table.append(el('thead'),el('tbody'));table.tHead.append(head);
  for(const r of rows){
    const tr=el('tr',undefined,r.label==='합계'?'total':undefined),th=el('th',r.label);th.scope='row';
    // Each first answer is shown with its share of the cards seen in that level.
    tr.append(th,el('td',String(r.total)),el('td',`${r.seen} (${pct(r.seen,r.total)})`),...r.first.map(n=>el('td',`${n} (${pct(n,r.seen)})`)));
    table.tBodies[0].append(tr);
  }
  $('level-summary-table').replaceChildren(table);
  $('level-summary-open').hidden=!studyGroups(cards()).some(g=>g.key==='first-weak')||selectedGroup==='first-weak';
}
function renderLibrary(){
  updateStats();
  const q=$('search').value.trim().toLocaleLowerCase();
  // "#tag" finds the cards that carry exactly that tag; anything else is searched in the card's text.
  const tagOnly=/^#\S+$/.test(q)?q.slice(1):null;
  const list=sortCards(cardsInGroup(cards(),selectedGroup),sortOrder).filter(c=>!q||(tagOnly!==null?c.tags.some(t=>t.toLocaleLowerCase()===tagOnly):[c.answer,c.front,c.ipa,c.sentence,c.memory,c.deck,...c.tags].join(' ').toLocaleLowerCase().includes(q)));
  // A long list is drawn a screenful at a time: the rest is added as the reader reaches the end.
  // Redrawing after a save shows as many rows as were on screen, so the reader keeps their place.
  // A new search, order or group starts again from one screenful.
  const listKey=`${q}\n${sortOrder}\n${selectedGroup}`;
  const shown=listKey===lastListKey?Math.max(60,$('card-list').children.length):60;
  lastListKey=listKey;
  $('card-list').replaceChildren();listRest=list.slice();appendRows(shown);
  // The button may still be on screen after the list was redrawn; watching it afresh makes it report that.
  listWatch?.unobserve($('list-more'));listWatch?.observe($('list-more'));
  $('list-count').textContent=store ? `${list.length}장` : '';
  renderLevelSummary();
  // Marked cards carry a tag, so showing them is a search for that tag across every card of this tab.
  $('flag-filters').replaceChildren(...Object.entries(flagKinds).flatMap(([kind,{tag,list}])=>{
    const count=inSection(cards()).filter(c=>hasFlag(c,kind)).length;if(!count)return [];
    const button=el('button',`${list} ${count}장`,'text-button');button.type='button';
    button.addEventListener('click',()=>{$('search').value='#'+tag;if(selectedGroup==='all')renderLibrary();else chooseGroup('all');});
    return [button];
  }));
  $('empty-library').hidden=list.length>0;
  $('empty-library').querySelector('h3').textContent=inSection(cards()).length?(q&&selectedGroup!=='all'?'선택한 묶음 안에는 검색에 맞는 카드가 없어요. 묶음을 ‘전체’로 바꾸면 모든 카드에서 찾아요.':'검색에 맞는 카드가 없어요.'):section==='cards'?'첫 카드를 만들어보세요.':'아직 이 탭의 카드가 없어요.';
  controls();
}
function clearMediaCache(){mediaCache.clear();}
function clearDraft(){for(const url of draftURLs)URL.revokeObjectURL(url);draftURLs.clear();draftMedia={image:null,audio:null};}
function source(path){return mediaCache.source(path);}
async function sources(card,withAudio=true){
  const urls={};
  await Promise.all((withAudio?['image','audio','wordAudio']:['image']).map(async type=>{if(card[type])urls[type]=await source(card[type].path);}));
  return urls;
}
function prepareReview(queue){
  if(store?.prepare)void store.prepare().catch(()=>{/* Saving retries preparation and reports any failure. */});
  for(const card of queue.slice(0,2))void sources(card).catch(()=>{/* Opening the card retries a failed prefetch. */});
}
function fields(){
  const result={type:$('card-type').value,deck:$('deck').value};
  for(const id of inputs)result[id]=$(id).value;
  for(const type of ['image','audio'])result[type]=draftMedia[type] ? {path:draftMedia[type].path,credit:$(`${type}-credit`).value.trim()}:null;
  return result;
}
function renderPreview(){
  showCard($('preview-card'),fields(),{image:draftMedia.image?.url,audio:draftMedia.audio?.url},previewBack);
  for(const [id,on] of [['preview-front',!previewBack],['preview-back',previewBack]]){$(id).classList.toggle('selected',on);$(id).setAttribute('aria-pressed',String(on));}
  for(const type of ['image','audio']){
    $(`${type}-name`).textContent=draftMedia[type]?.name || (type==='image'?'JPG · PNG · WebP, 최대 10MB':'MP3, 최대 10MB');
    $(`remove-${type}`).hidden=!draftMedia[type];
  }
}
function resetEditor(keep=false){
  const type=$('card-type').value, deck=$('deck').value, tags=$('tags').value;
  $('card-form').reset();
  if(keep){$('card-type').value=type;$('deck').value=deck;$('tags').value=tags;}
  editedId=null;dirty=false;previewBack=false;clearDraft();$('editor-error').hidden=true;
  $('editor-title').textContent='새 카드 추가';renderPreview();controls();
}
function switchView(next,force=false){
  if(busy)return false;
  if(!force&&view==='add'&&dirty&&next!=='add'&&!confirm('아직 저장하지 않은 입력이 있어요. 입력을 지우고 이동할까요?'))return false;
  if(next!=='add'&&view==='add'&&dirty)resetEditor();
  if(view==='review'&&next!=='review')void flushStaged();
  view=next;
  for(const name of ['library','add','review','memory'])$(`${name}-view`).hidden=name!==view;
  for(const b of document.querySelectorAll('[data-view]')){if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  history.replaceState(null,'',view==='add'?'#add':view==='review'?'#review':view==='memory'?'#memory':location.pathname+location.search);   // keep ?set= so a reload stays in this tab
  if(view==='library'){updateDecks();renderLibrary();}
  if(view==='add'){updateDecks();renderPreview();controls();}
  if(view==='review')startReview();
  if(view==='memory'){memorySkipped.clear();void showMemory(true);}
  return true;
}
function startReview(unknown=false,restart=false){
  if(busy)return;
  if(unknown)$('review-mode').value='due';
  unknownSession=unknown&&store?new Set(studyQueue(cards(),selectedGroup,'unknown').map(c=>c.id)):null;
  sessionCount=0;activeCard=null;
  const start=practiceStart();practiceIndex=restart?0:start;
  void showNextReview();
}
async function loadFolder(folder,epoch){
  await store?.flushNotes?.();
  const loaded=await FolderStore.open(folder);
  if(epoch!==connectionEpoch)return;
  store=loaded;clearMediaCache();lastSaved='';activeCard=null;unknownSession=null;practiceIndex=practiceStart();
  cachedFolder=loaded.folder;
  try{await rememberedFolder(loaded.folder);}catch{/* Permission handles are optional; folder files remain authoritative. */}
  $('reconnect').hidden=true;
  updateDecks();renderLibrary();
  notice(`${inSection(cards()).length}장의 카드와 복습 기록을 폴더에서 불러왔어요.`);
  if(view==='review')await showNextReview();
  if(view==='memory')await showMemory();
}
async function connect(previous=false){
  if(busy||saving||!supported)return;
  if(store&&dirty&&!confirm('폴더를 바꾸면 저장하지 않은 입력을 지워요. 다른 폴더를 연결할까요?'))return;
  const epoch=++connectionEpoch;setBusy(true);
  try{
    let selected;
    if(previous&&cachedFolder){
      if(await cachedFolder.requestPermission({mode:'readwrite'})!=='granted')throw new DOMException('Permission needed','NotAllowedError');
      selected=cachedFolder;
    }else selected=await window.showDirectoryPicker({id:'saymore-cards',mode:'readwrite',startIn:'documents'});
    const hadStore=Boolean(store);
    await loadFolder(selected,epoch);
    if(hadStore&&view==='add')resetEditor();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function reload(){
  if(!store||busy||saving)return;
  const epoch=++connectionEpoch;setBusy(true);
  try{if(store.kind==='dropbox')await loadCloud(epoch);else await loadFolder(store.folder,epoch);if(dirty)notice('최신 카드와 기록을 불러왔어요. 입력 중인 내용은 그대로 있어요. 검토한 뒤 저장해주세요.');}
  catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
function noteWarnings(result,announce=true){
  if(!result.warnings.length)return false;
  $('repair-notes').hidden=false;
  if(announce)notice('카드와 복습 기록은 저장했어요. 읽기용 노트 일부는 갱신하지 못했어요. “노트 다시 저장”으로 다시 시도해주세요.',true);
  return true;
}
function saved(result,message,{review=false}={}){
  lastSaved=dateLabel(new Date().toISOString());
  if(review)updateStats();else{updateDecks();renderLibrary();}
  if(!noteWarnings(result))notice(message);
}
// The library file is remembered in this browser so the next visit need not download it again.
let rememberedRev=null;
function rememberSnapshot(){
  if(store?.kind!=='dropbox'||!cloud?.connected||store.raw===null||!store.rev||store.rev===rememberedRev)return;
  rememberedRev=store.rev;void writeSnapshot({raw:store.raw,rev:store.rev,hash:store.hash});
}
// Cards changed on two devices that never saw each other's change. Nothing is thrown away: the other
// version is kept in journal.json in the Dropbox folder.
function conflictNote(){return store?.conflicts?` 카드 ${store.conflicts}장은 두 기기에서 서로 다르게 바뀌어 한쪽만 반영했어요. 다른 쪽 기록도 Dropbox에 남아 있어요.`:'';}
async function loadCloud(epoch){
  await store?.flushNotes?.();
  const loaded=await DropboxStore.open(cloud,store?.kind==='dropbox'?store:await readSnapshot());
  if(epoch!==connectionEpoch)return;
  store=loaded;clearMediaCache();lastSaved='';activeCard=null;unknownSession=null;
  // Settings from other devices first, so the group, the order and the first card are theirs too.
  // At most a few seconds: a slow answer is taken over later, the usual way.
  await Promise.race([shareSettings({redraw:false,force:true}),new Promise(resolve=>setTimeout(resolve,3000))]);
  if(epoch!==connectionEpoch)return;
  practiceIndex=practiceStart();
  rememberSnapshot();
  $('reconnect').hidden=true;updateDecks();renderLibrary();
  notice(`${inSection(cards()).length}장의 카드와 복습 기록을 Dropbox에서 불러왔어요.`+conflictNote());
  if(view==='review')await showNextReview();
  if(view==='memory')await showMemory();
}
async function connectCloud(){
  if(busy||saving)return;
  if(dirty&&!confirm('아직 저장하지 않은 입력이 있어요. 입력을 지우고 Dropbox에 연결할까요?'))return;
  if(dirty)resetEditor();
  const epoch=++connectionEpoch;setBusy(true);
  try{
    cloud=await openDropbox();keepSet();
    localStorage.setItem('saymore.cards.storage','dropbox');
    if(!cloud.connected){setBusy(false);try{if(section==='cards')sessionStorage.removeItem(returnKey);else sessionStorage.setItem(returnKey,section);}catch{/* Returns to the word-card tab. */}await cloud.authorize();return;}
    const hadStore=Boolean(store);
    await loadCloud(epoch);
    if(hadStore&&view==='add')resetEditor();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function refreshCloud(){
  // An open card preview plays its picture and sound from the cache a refresh would empty.
  if(refreshing||busy||saving||dirty||store?.pendingNotes||(view==='review'&&revealed)||$('detail-dialog').open||document.hidden||store?.kind!=='dropbox'||!cloud?.connected)return;
  refreshing=true;
  const previous=store,epoch=connectionEpoch;
  let applied=false;
  try{
    // Two small requests tell whether another device saved; the files are read only if one did.
    const seen=previous.version;
    if(!await previous.changed())return;
    const next=await DropboxStore.open(cloud,previous);
    // `seen` guards against a save of our own finishing while the files were being read.
    if(busy||saving||dirty||store?.pendingNotes||(view==='review'&&revealed)||store!==previous||previous.version!==seen||epoch!==connectionEpoch||next.version===seen)return;
    applied=true;setBusy(true);
    store=next;rememberSnapshot();clearMediaCache();updateDecks();renderLibrary();
    if(view==='review')await showNextReview();
    if(view==='memory')await showMemory();
    notice('다른 기기에서 저장한 최신 기록을 불러왔어요.'+conflictNote());
  }catch(e){notice(friendlyError(e),true);}finally{refreshing=false;if(applied)setBusy(false);}
}
async function saveCard(event){
  event.preventDefault();if(busy||saving||!store)return;
  const destination=event.submitter?.value || 'next';setBusy(true);$('editor-error').hidden=true;
  try{
    const previous=editedId ? cards().find(c=>c.id===editedId) : null;
    if(editedId&&!previous)throw Error('수정하던 카드가 이 폴더에 없어요. 입력 내용을 복사한 뒤 새 카드로 추가해주세요.');
    const card=previous ? editCard(previous,fields()) : newCard(fields());
    const nextCards=previous ? cards().map(c=>c.id===card.id?card:c) : [...cards(),card];
    const uploads={};for(const file of Object.values(draftMedia))if(file?.blob)uploads[file.path]=file.blob;
    const result=await store.commit({...store.library,cards:nextCards},uploads,[card.id]);
    const message=`${card.answer.slice(0,80)} 카드를 ${store.kind==='dropbox'?'Dropbox':'폴더'}에 저장했어요.`;
    dirty=false;resetEditor(true);saved(result,message);
    setBusy(false);
    if(destination==='list'||previous)switchView('library',true);else $('answer').focus();
  }catch(e){$('editor-error').textContent=friendlyError(e);$('editor-error').hidden=false;notice(friendlyError(e),true);}
  finally{setBusy(false);}
}
function playableMP3(url){
  return new Promise((resolve,reject)=>{
    const audio=new Audio();
    const finish=valid=>{clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();valid?resolve():reject(Error('MP3를 재생할 수 없어요. 정상적인 음성 파일을 선택해주세요.'));};
    const timer=setTimeout(()=>finish(false),4000);
    audio.onloadedmetadata=()=>finish(Number.isFinite(audio.duration)&&audio.duration>0);
    audio.onerror=()=>finish(false);audio.preload='metadata';audio.src=url;
  });
}
async function selectMedia(type,file,credit=''){
  if(!file)return;
  if(!file.size||file.size>10*1024*1024)throw Error('첨부파일은 0바이트보다 크고 10MB 이하여야 해요.');
  const extensions={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','audio/mpeg':'mp3'};
  const ext=extensions[file.type];
  if(!ext||(type==='audio'?ext!=='mp3':ext==='mp3'))throw Error('사진은 JPG·PNG·WebP, 음성은 MP3를 골라주세요.');
  if(type==='image'){
    try{const image=await createImageBitmap(file);image.close();}
    catch{throw Error('사진을 읽을 수 없어요. 정상적인 JPG·PNG·WebP 파일을 선택해주세요.');}
  }
  const url=URL.createObjectURL(file);draftURLs.add(url);
  if(type==='audio'){
    try{
      await playableMP3(url);
    }catch(e){URL.revokeObjectURL(url);draftURLs.delete(url);throw e;}
  }
  const previous=draftMedia[type]?.url;if(draftURLs.has(previous)){URL.revokeObjectURL(previous);draftURLs.delete(previous);}
  draftMedia[type]={path:`media/${crypto.randomUUID()}.${ext}`,blob:file,url,name:file.name || `${type}.${ext}`};
  $(`${type}-credit`).value=credit;dirty=true;renderPreview();
  $('editor-error').hidden=true;
}
async function fillSample(){
  if(busy)return;
  if(dirty&&!confirm('현재 입력을 coffee 예시로 바꿀까요?'))return;
  setBusy(true);
  try{
    const [image,audio]=await Promise.all(['coffee.jpg','coffee.mp3'].map(async name=>{const r=await fetch(`./sample/${name}`);if(!r.ok)throw Error('예시 파일을 불러오지 못했어요.');return r.blob();}));
    resetEditor();$('card-type').value='picture';$('answer').value='coffee';$('ipa').value='/ˈkɑː.fi/';$('sentence').value='I drink coffee every morning.';$('memory').value='Sunday morning · my favorite café';$('tags').value='food morning';
    await selectMedia('image',new File([image],'coffee.jpg',{type:'image/jpeg'}),'Julius Schorzman · CC BY-SA 2.0 · https://commons.wikimedia.org/wiki/File:A_small_cup_of_coffee.JPG');
    await selectMedia('audio',new File([audio],'coffee.mp3',{type:'audio/mpeg'}),'Dvortygirl · CC BY-SA 3.0 · Wikimedia MP3 · https://commons.wikimedia.org/wiki/File:En-us-coffee.ogg');
    dirty=true;renderPreview();notice('예시를 입력했어요. 나의 기억을 바꾼 뒤 저장해보세요.');
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function openEdit(id){
  if(busy)return;const card=cards().find(c=>c.id===id);if(!card)return;
  setBusy(true);
  resetEditor();editedId=id;$('editor-title').textContent='카드 수정';
  $('card-type').value=card.type;$('deck').value=card.deck;
  for(const key of inputs)$(key).value=key==='tags'?card.tags.join(' '):(card[key]??'');
  for(const type of ['image','audio'])if(card[type]){
    draftMedia[type]={...card[type],name:'저장된 '+(type==='image'?'사진':'음성')};
    $(`${type}-credit`).value=card[type].credit;
    try{draftMedia[type].url=await source(card[type].path);}catch(e){notice('첨부파일을 읽지 못했어요. 파일을 다시 선택한 뒤 저장해주세요.',true);}
  }
  dirty=false;setBusy(false);switchView('add',true);$('answer').focus();
}
async function openDetail(id,toFix=false){
  if(busy)return;
  // An answer still on its way to Dropbox may yet fail; the card shown here must be the stored one.
  if(saving){notice('방금 평가를 저장하고 있어요. 저장이 끝난 뒤 다시 눌러 주세요.');return;}
  detailCard=cards().find(c=>c.id===id);if(!detailCard)return;
  detailBack=false;
  try{showCard($('detail-card'),detailCard,await sources(detailCard),false);}catch(e){notice(friendlyError(e),true);return;}
  $('detail-flip').textContent='뒷면 보기';
  renderHistory();$('detail-dialog').showModal();
  if(toFix)$('detail-history').querySelector('.fix-rating')?.scrollIntoView({block:'center'});
}
function renderHistory(){
  const history=el('div'),overdue=waitLabel(overdueMs(detailCard));history.append(el('p',`다음 복습: ${dateLabel(detailCard.schedule.due)}${overdue?` (${overdue} 지남)`:''} · 복습 ${detailCard.reviews.length}회`));
  const last=detailCard.reviews.at(-1);
  if(last?.log){
    const box=el('div',undefined,'fix-rating'),buttons=el('div');
    box.append(el('p',`마지막 평가(${dateLabel(last.at)})를 잘못 눌렀다면 고칠 수 있어요.`));
    for(const rating of [1,2,3,4]){
      const button=el('button',ratings[rating]);button.type='button';button.setAttribute('aria-pressed',String(last.rating===rating));
      button.disabled=last.rating===rating||busy||saving;button.addEventListener('click',()=>fixRating(rating));buttons.append(button);
    }
    box.append(buttons);history.append(box);
  }
  if(detailCard.reviews.length){const ul=el('ul');const shown=detailCard.reviews.map((r,i)=>({r,late:waitLabel(reviewLateMs(detailCard,i))})).slice(-10).reverse();for(const {r,late} of shown)ul.append(el('li',`${dateLabel(r.at)} · ${ratings[r.rating]}${r.correctedFrom?` (${ratings[r.correctedFrom]}에서 고침)`:''}${late?` · 예정일보다 ${late} 늦게 복습`:''} → ${dateLabel(r.due)}`));history.append(ul);}
  history.append(el('p','미리 보기는 복습 기록을 바꾸지 않아요.'));$('detail-history').replaceChildren(history);
}
async function fixRating(rating){
  if(busy||saving||!store||!detailCard)return;
  const current=cards().find(c=>c.id===detailCard.id);if(!current)return;
  // Correcting changes the latest review. If the card on screen shows a different one, an older review would be rewritten.
  if(current.reviews.at(-1)?.at!==detailCard.reviews.at(-1)?.at){$('detail-dialog').close();notice('이 카드의 기록이 그사이 바뀌었어요. 카드를 다시 열어 확인해 주세요.',true);return;}
  setBusy(true);renderHistory();
  try{
    const updated=correctLastReview(current,rating);
    const result=await store.commit({...store.library,cards:cards().map(c=>c.id===updated.id?updated:c)},{},[updated.id]);
    detailCard=cards().find(c=>c.id===updated.id)||updated;
    if(lastGraded?.id===updated.id)lastGraded={id:updated.id,answer:updated.answer,rating};
    saved(result,`평가를 ${ratings[rating]}(으)로 고쳤어요. 다음 복습: ${dateLabel(updated.schedule.due)}`,{review:view==='review'});
    if(view==='review'&&!activeCard)await showNextReview();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);renderHistory();}
}
async function showNextReview(){
  // A group chosen on another device while a card was on screen takes over before the next card.
  if(pendingGroup&&!busy&&view==='review'){
    pendingGroup=false;let next=selectedGroup;try{next=localStorage.getItem(groupKey)||'all';}catch{/* Unchanged. */}
    if(next!==selectedGroup){selectedGroup=next;updateDecks();startReview(unknownSession!==null);return;}
  }
  const request=++reviewRequest,owner=store,practice=isPractice();
  const queue=!store?[]:unknownSession?
    studyQueue(cards(),selectedGroup,'unknown').filter(c=>unknownSession.has(c.id)):
    practice?practiceCards():studyQueue(cards(),selectedGroup,unseenOnly()?'unseen':'due',new Date(),$('review-order').value);
  const remaining=practice?queue.slice(practiceIndex):queue;
  activeCard=withStaged(remaining[0]||null);revealed=false;
  if(staged&&staged.id!==activeCard?.id)void flushStaged();
  flagControl();
  retryControls();$('check-due').hidden=unknownSession!==null;
  $('check-due').textContent=practice?'처음부터 다시 연습':'다시 확인';
  $('reveal').hidden=true;$('rating-area').hidden=true;
  $('reveal').textContent='정답 확인';$('practice-actions').hidden=!practice;
  $('review-active').hidden=!activeCard;$('review-empty').hidden=Boolean(activeCard);
  $('practice-previous').disabled=busy||practiceIndex===0;
  $('practice-next').disabled=busy||!activeCard;
  const waiting=activeCard?waitLabel(overdueMs(activeCard)):'';
  $('review-progress').textContent=(practice?`연습 ${Math.min(practiceIndex+1,queue.length)} / ${queue.length}장`:unseenOnly()?`안 본 카드 ${queue.length}장 남음 · 이번에 본 카드 ${sessionCount}장`:`이번에 복습한 카드 ${sessionCount}장`)+(activeCard?(activeCard.reviews.length?` · 이 카드: 지난 복습 ${dateLabel(activeCard.reviews.at(-1).at)}${waiting?`, 예정일에서 ${waiting} 지남`:''}`:' · 이 카드: 처음 보는 카드'):'');
  $('review-deck').textContent=studyGroups(cards()).find(g=>g.key===selectedGroup)?.label||'';
  if(!activeCard){
    if(practice&&store){
      $('review-empty-title').textContent=queue.length?'선택한 묶음 연습을 마쳤어요.':'선택한 묶음에 카드가 없어요.';
      $('next-due').textContent=queue.length?`${queue.length}장을 모두 봤어요. 다시 연습하거나 다른 묶음을 골라보세요.`:'다른 묶음을 선택하거나 카드를 추가해보세요.';return;
    }
    if(unknownSession){
      const remaining=studyQueue(cards(),selectedGroup,'unknown').length;
      $('review-empty-title').textContent=remaining?'모아둔 모름 카드를 한 번씩 모두 봤어요.':'모름 카드가 남아 있지 않아요.';
      $('next-due').textContent=remaining?'아직 모르는 카드는 원할 때 다시 꺼내보세요. 24시간이 지나면 오늘 복습에도 포함돼요.':'다음 복습 날짜를 예약했어요. “오늘 복습으로”에서 다른 카드도 공부할 수 있어요.';return;
    }
    if(unseenOnly()&&store){
      $('review-empty-title').textContent='안 본 카드가 없어요.';
      $('next-due').textContent=sessionCount?`이번에 ${sessionCount}장을 처음 봤어요. 이 묶음의 카드를 모두 한 번 이상 봤어요. 복습할 카드는 ‘복습 설정’에서 “오늘 복습”을 고르면 나와요.`:'이 묶음의 카드를 모두 한 번 이상 봤어요. 복습할 카드는 ‘복습 설정’에서 “오늘 복습”을 고르면 나와요.';return;
    }
    $('review-empty-title').textContent=store?'지금 복습할 카드가 없어요.':'먼저 Dropbox를 연결해주세요.';
    // A card answered 모름 is best tried again while the answer just seen is still fresh.
    const unknown=store?studyQueue(cards(),selectedGroup,'unknown').length:0;
    if(unknown){$('review-empty-title').textContent='오늘 볼 카드를 모두 봤어요.';$('next-due').textContent=`모름 카드 ${unknown}장이 있어요. 지금 위의 ‘모름 다시 보기’로 한 번 더 떠올려 보세요.`;return;}
    const future=cardsInGroup(cards(),selectedGroup).filter(c=>Date.parse(c.schedule.due)>Date.now()).sort((a,b)=>Date.parse(a.schedule.due)-Date.parse(b.schedule.due))[0];
    $('next-due').textContent=future?`다음 복습은 ${dateLabel(future.schedule.due)}예요. 지금 보고 싶다면 위의 ‘복습 설정’에서 “자유 연습”을 선택하세요.`:store?'다른 묶음을 선택하거나 카드를 추가해보세요.':'연결하면 저장된 카드와 복습 날짜를 불러와요.';return;
  }
  const card=activeCard,front=sources(card,false);
  $('review-card').textContent='카드를 불러오는 중…';
  prepareReview(remaining);
  const current=()=>request===reviewRequest&&owner===store&&view==='review';
  try{
    const urls=await front;if(!current())return;
    showCard($('review-card'),card,urls,false);$('reveal').hidden=false;
    // Arriving from the home page's "복습 시작": bring the card up past the storage box, once.
    if(cameToReview){cameToReview=false;$('review-view').scrollIntoView({block:'start'});}
    // The rating buttons that held the focus are gone; without this a keyboard or VoiceOver reader starts from the top of the page.
    if(lostFocus())$('review-card').firstElementChild?.focus({preventScroll:true});
  }catch(e){if(!current())return;notice(friendlyError(e),true);activeCard=null;$('review-active').hidden=true;$('review-empty').hidden=false;$('review-empty-title').textContent='첨부파일을 확인해주세요.';$('next-due').textContent='카드 목록에서 해당 카드의 사진·음성을 다시 선택해주세요.';}
}
// True when the control the reader was on has just been hidden.
function lostFocus(){const at=document.activeElement;return !at||at===document.body||(at.closest?.('#review-active')&&at.getClientRects().length===0);}
async function reveal(){
  if(busy||!activeCard)return;
  setBusy(true);
  try{
    const back=!isPractice()||!revealed;
    showCard($('review-card'),activeCard,await sources(activeCard),back);revealed=back;
    if(isPractice()){
      $('reveal').textContent=back?'앞면 보기':'정답 확인';
      if(!back){$('rating-area').hidden=true;return;}
    }
    const options=reviewOptions(activeCard);for(const b of document.querySelectorAll('[data-rating]'))b.querySelector('small').textContent=b.dataset.rating==='1'?'24시간 안':intervalLabel(options[b.dataset.rating].due);
    $('reveal').hidden=!isPractice();$('rating-area').hidden=false;
    // Not a rating button: Space pressed twice would then grade the card.
    if(lostFocus())$('review-card').firstElementChild?.focus({preventScroll:true});
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function grade(rating){
  if(busy||saving||!store||!activeCard||!revealed)return;
  const owner=store,previousGraded=lastGraded,retry=unknownSession!==null,practice=isPractice(),previousIndex=practiceIndex;
  // Marks just made on this card go into the same save as the answer.
  const marked=staged?.id===activeCard.id;
  let updated;
  try{updated=rateCard(activeCard,rating,new Date(),{retryUnknown:retry,early:practice});}catch(e){notice(friendlyError(e),true);return;}
  if(marked)staged=null;
  const next=cards().map(c=>c.id===updated.id?updated:c);
  // Saving a megabyte to Dropbox takes a second or more. Move on to the next card at once; the next
  // answer waits until this one is stored, and a failed save brings this card back.
  saving=true;pendingCards=next;
  if(practice){const group=practiceCards(next);practiceIndex=Math.min(practiceIndex+1,group.length);rememberPractice(group[practiceIndex]?.id||null);}
  const commit=store.commit({...store.library,cards:next},{},[updated.id],undefined,{deferNotes:true});
  const wasUnknown=unknownSession?.delete(updated.id);
  lastGraded={id:updated.id,answer:updated.answer,rating};sessionCount++;
  notice('복습 기록을 저장하고 있어요…');
  controls();void showNextReview();
  try{
    const result=await commit;
    const message=rating===1?'모름 카드에 넣었어요.':`복습 기록을 저장했어요. 다음 복습: ${dateLabel(updated.schedule.due)}`;
    pendingCards=null;saving=false;
    if(store===owner){
      saved(result,message,{review:true});
      const savedNotice=noticeVersion;
      const reportNotes=notes=>{if(store===owner)noteWarnings(notes,noticeVersion===savedNotice);};
      if(result.notes)void result.notes.then(reportNotes,error=>reportNotes({warnings:[{message:error.message}]}));
      if(store.prepare)void store.prepare().catch(()=>{/* The next save retries preparation. */});
    }
  }catch(e){
    pendingCards=null;saving=false;
    if(store===owner){
      lastGraded=previousGraded;sessionCount--;if(wasUnknown)unknownSession.add(updated.id);
      if(practice){practiceIndex=previousIndex;rememberPractice(updated.id);}
      // Another device answered this card first: read its answer now, not at the next half-minute check.
      const clash=/다른 기기에서도 바뀌었어요/.test(e?.message||'');
      notice(clash?`‘${updated.answer.slice(0,40)}’ 카드가 다른 기기에서 먼저 바뀌었어요. 방금 평가는 저장하지 않았고, 최신 기록을 다시 읽어요.`:`${friendlyError(e)} 방금 평가한 ‘${updated.answer.slice(0,40)}’ 카드는 ${marked?'표시와 함께 ':''}저장되지 않아 다시 보여드려요.`,true);
      await showNextReview();
      if(clash)void refreshCloud();
    }
  }finally{controls();}
}
function movePractice(step){
  if(busy||!store||!isPractice())return;
  const group=practiceCards();
  practiceIndex=Math.max(0,Math.min(practiceIndex+step,group.length));
  rememberPractice(group[practiceIndex]?.id||null); // only moving through cards updates the position, not opening the mode
  void showNextReview();
}

$('connect').addEventListener('click',()=>connect());$('reconnect').addEventListener('click',()=>connect(true));$('reload').addEventListener('click',reload);
$('connect-dropbox').addEventListener('click',connectCloud);
$('disconnect-dropbox').addEventListener('click',async()=>{
  if(busy||saving)return;setBusy(true);
  try{
    await store?.flushNotes?.();const signedIn=cloud?.credentials;cloud?.disconnect();void cloud?.revoke?.(signedIn);connectionEpoch++;
    if(store?.kind==='dropbox'){store=null;clearMediaCache();activeCard=null;unknownSession=null;renderLibrary();if(view==='review')showNextReview();}
    rememberedRev=null;await clearSnapshot();
    notice('이 브라우저의 연결을 해제했어요. Dropbox에 저장된 카드와 기록은 그대로 있어요.');
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
});
$('import-folder').addEventListener('change',async event=>{
  const files=[...event.target.files];if(!files.length||busy||store?.kind!=='dropbox')return;
  if(dirty){notice('먼저 입력 중인 카드를 저장하거나 입력을 취소해 주세요.',true);event.target.value='';return;}
  setBusy(true);
  try{
    const result=await store.importFiles(files,(done,total)=>notice(`Dropbox로 옮기고 검증 중… ${done} / ${total}개 파일`));
    clearMediaCache();updateDecks();renderLibrary();
    notice(`카드 ${result.cards}장, 파일 ${result.files}개를 Dropbox에 옮겨 검증했어요. 원본 폴더는 그대로 남겨두었습니다.`);
    if(view==='review')await showNextReview();
    if(view==='memory')await showMemory();
  }catch(e){notice(friendlyError(e),true);}finally{event.target.value='';setBusy(false);}
});
async function importBundle(append=false){
  if(busy||saving||store?.kind!=='dropbox')return;
  if(dirty){notice('먼저 입력 중인 카드를 저장하거나 입력을 취소해 주세요.',true);return;}
  setBusy(true);
  try{
    notice('백업 파일의 내용을 확인하고 있어요.');
    const file=$('image-bundle-file').files[0];
    if(file&&file.size>50*1024*1024)throw Error('50MB 이하의 카드 묶음을 사용해 주세요.');
    const files=await parseBundle(file?await file.text():$('bundle-data').value);
    const progress=(done,total)=>notice(`Dropbox에 저장하고 확인 중… ${done} / ${total}`);
    // A picture or recording that cannot be opened is refused here, as when filling an empty one.
    if(append)for(const {path,blob} of files){
      try{
        if(/^media\/[^/]+\.mp3$/.test(path)){const url=URL.createObjectURL(blob);try{await playableMP3(url);}finally{URL.revokeObjectURL(url);}}
        else if(/^media\/[^/]+\.(jpg|png|webp)$/.test(path)){const image=await createImageBitmap(blob);image.close();}
      }catch{throw Error(`묶음 안의 ${path} 파일을 열 수 없어요. 묶음을 다시 만들어 주세요. 아무것도 저장하지 않았어요.`);}
    }
    const result=append ? await store.appendEntries(files,progress) : await store.importEntries(files,progress);
    $('bundle-data').value='';$('image-bundle-file').value='';$('bundle-panel').open=false;
    clearMediaCache();updateDecks();renderLibrary();
    if(append)saved(result,`새 카드 ${result.added}장을 추가했어요. 중복 ${result.skipped}장은 건너뛰었고 기존 카드와 복습 기록은 유지했어요.`);
    else notice(`카드 ${result.cards}장, 파일 ${result.files}개를 Dropbox에 옮겨 검증했어요. 원본은 그대로 유지합니다.`);
    if(view==='review')await showNextReview();
    if(view==='memory')await showMemory();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
$('fill-image-bundle').addEventListener('click',async()=>{
  if(busy||store?.kind!=='dropbox')return;
  if(dirty){notice('먼저 입력 중인 카드를 저장하거나 입력을 취소해 주세요.',true);return;}
  setBusy(true);
  try{
    const file=$('image-bundle-file').files[0];
    if(file&&file.size>52428800)throw new Error('묶음 파일은 50MB 이하로 선택해 주세요.');
    notice('묶음의 내용을 확인하고 있어요.');
    const files=await parseBundle(file?await file.text():$('bundle-data').value);
    // The same button fills pictures or recordings, or rewrites wording; the bundle's own list says which.
    const kind=patchKind(files),audio=kind==='audio',what={audio:'녹음을',image:'이미지를',text:'바뀐 글을'}[kind];
    const patch=await ({audio:prepareAudioPatch,image:prepareImagePatch,text:prepareTextPatch}[kind])(store.library,files);
    for(const blob of Object.values(patch.uploads)){
      if(audio){const url=URL.createObjectURL(blob);try{await playableMP3(url);}finally{URL.revokeObjectURL(url);}}
      else{const image=await createImageBitmap(blob);image.close();}
    }
    const result=patch.ids.length?await store.commit(patch.next,patch.uploads,patch.ids,(done,total)=>notice(`${what} 저장하고 확인 중… ${done} / ${total}`)):{warnings:[]};
    $('bundle-data').value='';$('bundle-panel').open=false;
    clearMediaCache();renderLibrary();
    $('image-bundle-file').value='';
    saved(result,kind==='text'?`카드 ${patch.ids.length}장의 글을 바꿨어요. 이미 바뀌어 있던 ${patch.skipped}장은 그대로예요. 복습 기록은 유지했어요.`:audio?`카드 ${patch.ids.length}장에 녹음을 붙였어요. 이미 녹음이 있는 ${patch.skipped}장은 유지했어요.`:`카드 ${patch.ids.length}장에 이미지를 채웠어요. 이미 그림이 있는 ${patch.skipped}장은 유지했어요.`);
    if(view==='review')await showNextReview();
    if(view==='memory')await showMemory();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
});
$('import-bundle').addEventListener('click',()=>importBundle(false));
$('append-bundle').addEventListener('click',()=>importBundle(true));
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{if(b.dataset.view==='add'&&view!=='add')resetEditor();switchView(b.dataset.view);});
for(const b of document.querySelectorAll('[data-open-add]'))b.addEventListener('click',()=>switchView('add'));
// Typing redraws the list once the reader pauses, not on every letter.
let searchTimer=0;
$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderLibrary,150);});
for(const button of $('flag-row').querySelectorAll('button'))button.addEventListener('click',()=>toggleFlag(button.dataset.flag));
for(const [value,label] of Object.entries(sortOrders)){const option=el('option',label);option.value=value;$('sort-order').append(option);}
$('sort-order').value=sortOrder;
$('list-more').addEventListener('click',()=>appendRows());
listWatch?.observe($('list-more'));
$('sort-order').addEventListener('change',()=>{sortOrder=$('sort-order').value;setSetting('saymore.cards.sort.v1',sortOrder);shareSoon();renderLibrary();});
$('fix-last').addEventListener('click',()=>lastGraded&&openDetail(lastGraded.id,true));
for(const id of ['deck-filter','review-group'])$(id).addEventListener('change',()=>chooseGroup($(id).value));
$('memory-form').addEventListener('submit',event=>saveMemory(event));
$('memory-unmark').addEventListener('click',()=>saveMemory(null,{unmark:true}));
$('memory-skip').addEventListener('click',()=>{if(busy||!memoryCard)return;if(memoryQueue().length<2){notice('남은 카드가 이 한 장이에요. 떠오를 때 적거나 표시만 풀어 주세요.');return;}memorySkipped.add(memoryCard.id);memoryCard=null;void showMemory(true);});
$('level-summary-open').addEventListener('click',()=>{if(busy)return;$('search').value='';chooseGroup('first-weak');$('deck-filter').scrollIntoView({block:'center'});$('deck-filter').focus({preventScroll:true});});
// The page always opens in a rated mode: a remembered practice mode hid the answer buttons.
try{localStorage.removeItem('saymore.cards.review-mode.v1');}catch{/* Nothing to clear. */}
$('review-mode').value=savedMode();
$('review-mode').addEventListener('change',()=>{const mode=$('review-mode').value;if(ratedModes.includes(mode)&&mode!==savedMode()){setSetting(modeKey,mode);shareSoon();}startReview();});
for(const [value,label] of Object.entries(reviewOrders)){const option=el('option',label);option.value=value;$('review-order').append(option);}
$('review-order').value=savedOrder();
$('review-order').addEventListener('change',()=>{const order=$('review-order').value;if(order!==savedOrder()){setSetting(orderKey,order);shareSoon();}startReview();});

$('card-form').addEventListener('input',()=>{dirty=true;renderPreview();});$('card-form').addEventListener('submit',saveCard);
$('card-form').addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();if(!busy&&store)$('card-form').requestSubmit(editedId?$('save-list'):$('save-next'));}});
$('preview-front').addEventListener('click',()=>{previewBack=false;renderPreview();});$('preview-back').addEventListener('click',()=>{previewBack=true;renderPreview();});
$('cancel-edit').addEventListener('click',()=>{if(dirty&&!confirm('저장하지 않은 입력을 지울까요?'))return;resetEditor();switchView('library',true);});
for(const type of ['image','audio']){
  $(type).addEventListener('change',async()=>{setBusy(true);try{await selectMedia(type,$(type).files[0]);}catch(e){$('editor-error').textContent=friendlyError(e);$('editor-error').hidden=false;}finally{$(type).value='';setBusy(false);}});
  $(`remove-${type}`).addEventListener('click',()=>{draftMedia[type]=null;$(`${type}-credit`).value='';dirty=true;renderPreview();});
}
$('fill-sample').addEventListener('click',fillSample);
$('close-detail').addEventListener('click',()=>$('detail-dialog').close());
$('detail-flip').addEventListener('click',async()=>{if(!detailCard)return;try{detailBack=!detailBack;showCard($('detail-card'),detailCard,await sources(detailCard),detailBack);$('detail-flip').textContent=detailBack?'앞면 보기':'뒷면 보기';}catch(e){notice(friendlyError(e),true);}});
$('reveal').addEventListener('click',reveal);$('check-due').addEventListener('click',()=>isPractice()?startReview(false,true):showNextReview());
$('practice-previous').addEventListener('click',()=>movePractice(-1));$('practice-next').addEventListener('click',()=>movePractice(1));
$('review-unknown').addEventListener('click',()=>startReview(true));$('review-normal').addEventListener('click',()=>{$('review-mode').value=savedMode();startReview();});
for(const b of document.querySelectorAll('[data-rating]'))b.addEventListener('click',()=>grade(Number(b.dataset.rating)));
$('repair-notes').addEventListener('click',async()=>{if(!store||busy)return;setBusy(true);try{const result=await store.exportNotes();$('repair-notes').hidden=result.warnings.length===0;saved(result,'읽기용 노트를 다시 저장했어요.');}catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}});
window.addEventListener('beforeunload',e=>{if(staged)void flushStaged();if(dirty||busy||saving||staged||store?.pendingNotes){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey||e.altKey)return;if(view!=='review'||busy||$('detail-dialog').open||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){if(e.target.closest('button,a,summary'))return;e.preventDefault();if(!revealed||isPractice())reveal();}else if(revealed&&/^[1-4]$/.test(e.key))grade(Number(e.key));});
setInterval(()=>{if(store&&!busy)updateStats();rememberSnapshot();void refreshCloud();},30000);
window.addEventListener('pageshow',()=>void refreshCloud());
window.addEventListener('online',()=>void refreshCloud());
// GitHub Pages lets the browser reuse this page for ten minutes, so a new release can lag behind.
// Ask for the page without the cache and reload once when it names a newer app module.
async function checkForUpdate(){
  if(busy||saving||dirty||store?.pendingNotes||(view==='review'&&revealed)||$('detail-dialog').open)return;
  try{
    const current=new URL(import.meta.url).searchParams.get('v');
    const response=await fetch(location.pathname,{cache:'no-store'});if(!current||!response.ok)return;
    const latest=(await response.text()).match(/app\.mjs\?v=([\w-]+)/)?.[1];
    if(!latest||latest===current||sessionStorage.getItem('saymore.cards.updated-to')===latest)return;
    sessionStorage.setItem('saymore.cards.updated-to',latest);
    await fetch(location.pathname,{cache:'reload'});
    location.reload();
  }catch{/* Offline or blocked storage: keep using the loaded version. */}
}
// Another tab of this site changed a shared setting.
window.addEventListener('storage',event=>{if(settingKeys.includes(event.key)&&event.key!=='saymore.home.cards.v1')applySettings([event.key]);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&staged)void flushStaged();if(!document.hidden){void refreshCloud();void checkForUpdate();if(!busy&&!saving)void shareSettings();}});
void checkForUpdate();
window.addEventListener('storage',async event=>{
  if(event.key!=='saymore.dropbox.auth.v1'||!cloud)return;
  controls();
  // A token renewed by another tab rewrites the same key. With the library already open, that is only
  // a reason to check for changes, under the rules that keep a card being answered in place.
  if(cloud.connected&&store?.kind==='dropbox'){void refreshCloud();return;}
  if(cloud.connected&&!busy&&!saving&&!dirty){const epoch=++connectionEpoch;setBusy(true);try{await loadCloud(epoch);}catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}}
  else if(!cloud.connected){
    // Disconnected from another tab or page: the copy of the cards kept in this browser goes too.
    rememberedRev=null;void clearSnapshot().catch(()=>{});
    notice('이 브라우저의 Dropbox 연결이 해제되었어요. 다시 연결하면 저장된 기록을 읽을 수 있어요.');
  }
});
if(section!=='cards'){
  const text={form:['WORD FORMS','단어 형태','went, children, says처럼 모양이 바뀌는 단어를 문장 속에서 익혀요.'],
    order:['WORD ORDER','문장 어순','빠진 말이 문장의 어디에 들어가는지 익혀요.'],
    work:['WORK ENGLISH','업무 영어','빈칸 아래 영어 뜻풀이를 보고 일할 때 쓰는 단어를 떠올려요. -s·-ed 형태가 달라도 맞힌 거예요.']}[section];
  document.title=`${text[1]} · Say More`;
  document.querySelector('.intro .eyebrow').textContent=text[0];
  document.querySelector('.intro h1').textContent=text[1];
  document.querySelector('.intro h1+p').textContent=text[2];
  // New cards made here would have no place in this tab; they are added from the word cards tab.
  for(const button of document.querySelectorAll('[data-view="add"],[data-open-add]'))button.hidden=true;
}
for(const link of document.querySelectorAll('.site-header nav a')){
  const current=link.dataset.section===section;
  if(current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
}
$('browser-support').textContent='Dropbox 저장은 아이폰 Safari와 맥 Chrome에서 사용할 수 있어요. 사진·음원도 내 Dropbox에 저장해요.';
resetEditor();renderLibrary();
if(location.hash==='#add'&&section==='cards')switchView('add',true);else if(location.hash==='#review')switchView('review',true);else if(location.hash==='#memory')switchView('memory',true);
async function restoreConnection(){
 try{cloud=await openDropbox();keepSet();if(cloud.connected){const epoch=++connectionEpoch;setBusy(true);try{await loadCloud(epoch);}finally{setBusy(false);}return;}}
 catch(e){notice(friendlyError(e),true);}
 if(supported)rememberedFolder().then(async folder=>{
  if(!folder||connectionEpoch)return;cachedFolder=folder;
  if(await folder.queryPermission({mode:'readwrite'})==='granted'&&!connectionEpoch){setBusy(true);try{await loadFolder(folder,0);}catch(e){notice(friendlyError(e),true);$('reconnect').hidden=false;}finally{setBusy(false);}}
  else if(!connectionEpoch)$('reconnect').hidden=false;
 }).catch(()=>{/* Re-selecting the folder works when the browser cannot retain handles. */});
 controls();
}
void restoreConnection();
