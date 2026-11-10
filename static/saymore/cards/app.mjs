import {newCard, editCard, rateCard, reviewOptions, dueCards, dateLabel, intervalLabel, ratings} from './model.mjs?v=3';
import {studyGroups,cardsInGroup,studyQueue,studyProgress} from './study-groups.mjs?v=2';
import {FolderStore, rememberedFolder, friendlyError} from './storage.mjs?v=3';
import {el, showCard} from './view.mjs?v=2';
import {DropboxStore} from './dropbox-store.mjs?v=6';
import {MediaCache} from './media-cache.mjs?v=1';
import {parseBundle} from './bundle.mjs?v=1';
import {prepareImagePatch} from './image-patch.mjs?v=1';
import {openDropbox} from '../shared/dropbox.mjs?v=2';

const $=id=>document.getElementById(id);
let store=null, cachedFolder=null, view='library', busy=false, dirty=false, editedId=null, previewBack=false;
let draftMedia={image:null,audio:null}, activeCard=null, revealed=false, sessionCount=0, unknownSession=null, detailCard=null, detailBack=false;
let connectionEpoch=0, reviewRequest=0, noticeVersion=0, lastSaved='', draftURLs=new Set();
const mediaCache=new MediaCache(path=>store.readMedia(path));
const inputs=['front','answer','ipa','speech','sentence','memory','tags'];
const supported=typeof window.showDirectoryPicker==='function';
let cloud=null,refreshing=false;
let selectedGroup='all',practiceIndex=0;
try{selectedGroup=localStorage.getItem('saymore.cards.group.v1')||'all';}catch{/* Selection is optional when browser storage is unavailable. */}

function notice(message,error=false){noticeVersion++;$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
function cards(){return store?.library.cards || [];}
function controls(){
  for(const button of document.querySelectorAll(view==='library'?'button':'button:not(#card-list button)'))button.disabled=busy;
  for(const input of $('card-form').querySelectorAll('input,textarea,select'))input.disabled=busy;
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
  for(const id of ['deck-filter','review-group','review-mode'])$(id).disabled=busy;
  $('practice-previous').disabled=busy||practiceIndex===0;
  $('practice-next').disabled=busy||!activeCard;
  $('save-help').textContent=store ? `저장하면 카드와 복습 일정이 ${online?'Dropbox':'선택한 폴더'}에 남아요.` : '먼저 위의 Dropbox 연결을 눌러주세요. 입력한 내용은 그대로 남아요.';
  $('reload').hidden=!store;
  $('connection').textContent=online ? 'Dropbox 연결됨' : store ? `${store.folder.name} 폴더 연결됨` : '저장소 연결 전';
  $('connection').classList.toggle('connected',Boolean(store));
  $('connect').textContent=store ? '다른 폴더 연결':'폴더 연결';
  $('storage-copy').textContent=store ? `카드·복습 날짜·전체 기록을 ${online?'Dropbox 전용 폴더':'선택한 폴더'}에 저장해요.${lastSaved ? ' 마지막 저장 '+lastSaved : ''}` : '같은 Dropbox 계정을 연결하면 아이폰과 맥에서 이어서 공부할 수 있어요.';
  retryControls();
}
function retryControls(){
  const count=store?studyQueue(cards(),selectedGroup,'unknown').length:0,practice=isPractice();
  $('review-unknown').hidden=practice||!count||Boolean(unknownSession&&activeCard);
  $('review-unknown').textContent=`모름 다시 보기 · ${count}장`;
  $('review-normal').hidden=practice||unknownSession===null;
  $('unknown-help').hidden=practice||!count;
  $('review-title').textContent=practice?'자유 연습':unknownSession?'모름 다시 보기':'오늘 복습';
  const groups=studyGroups(cards()),now=new Date();
  for(const id of ['deck-filter','review-group'])for(const option of $(id).options){
    const group=groups.find(g=>g.key===option.value);if(group)option.textContent=groupLabel(group,now);
  }
  const group=groups.find(g=>g.key===selectedGroup),progress=studyProgress(group?.cards||[],now);
  $('review-group-help').textContent=store?`${group?.label||'선택한 묶음'} · 전체 ${progress.total}장 · 오늘 완료 ${progress.completedToday}장 · 지금 남음 ${progress.remaining}장 · 다음 복습 대기 ${progress.waiting}장. 오늘 완료는 오늘 평가한 뒤 정기 복습에서 빠진 카드예요. ‘모름’은 원할 때 따로 다시 볼 수 있어요.`:'Dropbox를 연결하면 IPA와 100장씩 나눈 단어 묶음을 고를 수 있어요.';
  $('review-mode-help').textContent=practice?'선택한 묶음 전체를 순서대로 연습해요. 복습 기록과 다음 날짜는 바뀌지 않아요.':'새 카드와 복습 날짜가 된 카드를 보여줘요. 정답 확인 후 평가하면 기록과 다음 날짜가 저장돼요.';
}
function isPractice(){return $('review-mode').value==='practice';}
function setBusy(value){busy=value;controls();}
function updateStats(){
  $('total-count').textContent=cards().length;
  $('new-count').textContent=cards().filter(c=>c.schedule.state===0).length;
  $('due-count').textContent=store ? dueCards(store.library).filter(c=>c.schedule.state!==0).length : 0;
}
function groupLabel(group,now=new Date()){
  const p=studyProgress(group.cards,now);
  return `${group.label} · ${p.total}장 · 오늘 완료 ${p.completedToday} · 남음 ${p.remaining}`;
}
function updateDecks(){
  const decks=[...new Set(cards().map(c=>c.deck))].sort((a,b)=>a.localeCompare(b));
  const groups=studyGroups(cards());
  if(!groups.some(g=>g.key===selectedGroup))selectedGroup='all';
  for(const id of ['deck-filter','review-group']){
    const select=$(id);select.replaceChildren();
    for(const section of [...new Set(groups.map(g=>g.section))]){
      const optgroup=el('optgroup');optgroup.label=section;
      for(const group of groups.filter(g=>g.section===section))optgroup.append(new Option(groupLabel(group),group.key));
      select.append(optgroup);
    }
    select.value=selectedGroup;
  }
  $('known-decks').replaceChildren(...decks.map(d=>new Option(d,d)));
}
function chooseGroup(key){
  if(busy)return;
  selectedGroup=key;
  try{localStorage.setItem('saymore.cards.group.v1',key);}catch{/* The selected group still works for this visit. */}
  $('deck-filter').value=$('review-group').value=key;
  if(view==='review')startReview(unknownSession!==null);else renderLibrary();
}
function renderLibrary(){
  updateStats();
  const q=$('search').value.trim().toLocaleLowerCase();
  const list=cardsInGroup(cards(),selectedGroup).filter(c=>!q||[c.answer,c.front,c.sentence,c.memory,c.deck,...c.tags].join(' ').toLocaleLowerCase().includes(q));
  $('card-list').replaceChildren();
  for(const c of list){
    const row=el('article',undefined,'card-row'), title=el('div');
    title.append(el('h3',c.answer),el('p',[c.ipa,c.deck,c.tags.map(t=>'#'+t).join(' ')].filter(Boolean).join(' · ')));
    const schedule=el('div',undefined,'row-schedule');
    const state=c.schedule.state===0?'새 카드':Date.parse(c.schedule.due)<=Date.now()?'복습할 시간':'다음 복습';
    schedule.append(el('span',state,'status'),el('span',c.schedule.state===0?'바로 학습할 수 있어요':dateLabel(c.schedule.due)),el('p',`복습 ${c.reviews.length}회`));
    const actions=el('div',undefined,'row-actions'), preview=el('button','미리 보기','text-button'), edit=el('button','수정','text-button');
    preview.addEventListener('click',()=>openDetail(c.id));edit.addEventListener('click',()=>openEdit(c.id));
    actions.append(preview,edit);row.append(title,schedule,actions);$('card-list').append(row);
  }
  $('list-count').textContent=store ? `${list.length}장` : '';
  $('empty-library').hidden=list.length>0;
  $('empty-library').querySelector('h3').textContent=cards().length?'검색에 맞는 카드가 없어요.':'첫 카드를 만들어보세요.';
  controls();
}
function clearMediaCache(){mediaCache.clear();}
function clearDraft(){for(const url of draftURLs)URL.revokeObjectURL(url);draftURLs.clear();draftMedia={image:null,audio:null};}
function source(path){return mediaCache.source(path);}
async function sources(card,withAudio=true){
  const urls={};
  await Promise.all((withAudio?['image','audio']:['image']).map(async type=>{if(card[type])urls[type]=await source(card[type].path);}));
  return urls;
}
function prepareReview(queue){
  if(!isPractice()&&store?.prepare)void store.prepare().catch(()=>{/* Saving retries preparation and reports any failure. */});
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
  view=next;
  for(const name of ['library','add','review'])$(`${name}-view`).hidden=name!==view;
  for(const b of document.querySelectorAll('[data-view]')){if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
  history.replaceState(null,'',view==='add'?'#add':view==='review'?'#review':location.pathname);
  if(view==='library'){updateDecks();renderLibrary();}
  if(view==='add'){updateDecks();renderPreview();controls();}
  if(view==='review')startReview();
  return true;
}
function startReview(unknown=false){
  if(busy)return;
  if(unknown)$('review-mode').value='due';
  unknownSession=unknown&&store?new Set(studyQueue(cards(),selectedGroup,'unknown').map(c=>c.id)):null;
  sessionCount=0;practiceIndex=0;activeCard=null;void showNextReview();
}
async function loadFolder(folder,epoch){
  await store?.flushNotes?.();
  const loaded=await FolderStore.open(folder);
  if(epoch!==connectionEpoch)return;
  store=loaded;clearMediaCache();lastSaved='';activeCard=null;unknownSession=null;practiceIndex=0;
  cachedFolder=loaded.folder;
  try{await rememberedFolder(loaded.folder);}catch{/* Permission handles are optional; folder files remain authoritative. */}
  $('reconnect').hidden=true;
  updateDecks();renderLibrary();
  notice(`${cards().length}장의 카드와 복습 기록을 폴더에서 불러왔어요.`);
  if(view==='review')await showNextReview();
}
async function connect(previous=false){
  if(busy||!supported)return;
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
  if(!store||busy)return;
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
async function loadCloud(epoch){
  await store?.flushNotes?.();
  const loaded=await DropboxStore.open(cloud);
  if(epoch!==connectionEpoch)return;
  store=loaded;clearMediaCache();lastSaved='';activeCard=null;unknownSession=null;practiceIndex=0;
  $('reconnect').hidden=true;updateDecks();renderLibrary();
  notice(`${cards().length}장의 카드와 복습 기록을 Dropbox에서 불러왔어요.`);
  if(view==='review')await showNextReview();
}
async function connectCloud(){
  if(busy)return;
  if(dirty&&!confirm('아직 저장하지 않은 입력이 있어요. 입력을 지우고 Dropbox에 연결할까요?'))return;
  if(dirty)resetEditor();
  const epoch=++connectionEpoch;setBusy(true);
  try{
    cloud=await openDropbox();
    localStorage.setItem('saymore.cards.storage','dropbox');
    if(!cloud.connected){setBusy(false);await cloud.authorize();return;}
    const hadStore=Boolean(store);
    await loadCloud(epoch);
    if(hadStore&&view==='add')resetEditor();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function refreshCloud(){
  if(refreshing||busy||dirty||store?.pendingNotes||(view==='review'&&revealed)||document.hidden||store?.kind!=='dropbox'||!cloud?.connected)return;
  refreshing=true;
  const previous=store,epoch=connectionEpoch;
  let applied=false;
  try{
    const next=await DropboxStore.open(cloud);
    if(busy||dirty||store?.pendingNotes||(view==='review'&&revealed)||store!==previous||epoch!==connectionEpoch||next.rev===previous.rev)return;
    applied=true;setBusy(true);
    store=next;clearMediaCache();updateDecks();renderLibrary();
    if(view==='review')await showNextReview();
    notice('다른 기기에서 저장한 최신 기록을 불러왔어요.');
  }catch(e){notice(friendlyError(e),true);}finally{refreshing=false;if(applied)setBusy(false);}
}
async function saveCard(event){
  event.preventDefault();if(busy||!store)return;
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
      await new Promise((resolve,reject)=>{
        const audio=new Audio();
        const finish=valid=>{clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;audio.removeAttribute('src');audio.load();valid?resolve():reject(Error('MP3를 재생할 수 없어요. 정상적인 음성 파일을 선택해주세요.'));};
        const timer=setTimeout(()=>finish(false),4000);
        audio.onloadedmetadata=()=>finish(Number.isFinite(audio.duration)&&audio.duration>0);
        audio.onerror=()=>finish(false);audio.preload='metadata';audio.src=url;
      });
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
async function openDetail(id){
  if(busy)return;detailCard=cards().find(c=>c.id===id);if(!detailCard)return;
  detailBack=false;
  try{showCard($('detail-card'),detailCard,await sources(detailCard),false);}catch(e){notice(friendlyError(e),true);return;}
  $('detail-flip').textContent='뒷면 보기';
  const history=el('div');history.append(el('p',`다음 복습: ${dateLabel(detailCard.schedule.due)} · 복습 ${detailCard.reviews.length}회`));
  if(detailCard.reviews.length){const ul=el('ul');for(const r of detailCard.reviews.slice(-10).reverse())ul.append(el('li',`${dateLabel(r.at)} · ${ratings[r.rating]} → ${dateLabel(r.due)}`));history.append(ul);}
  history.append(el('p','미리 보기는 복습 기록을 바꾸지 않아요.'));$('detail-history').replaceChildren(history);$('detail-dialog').showModal();
}
async function showNextReview(){
  const request=++reviewRequest,owner=store,practice=isPractice();
  const queue=!store?[]:unknownSession?
    studyQueue(cards(),selectedGroup,'unknown').filter(c=>unknownSession.has(c.id)):
    studyQueue(cards(),selectedGroup,practice?'practice':'due');
  const remaining=practice?queue.slice(practiceIndex):queue;
  activeCard=remaining[0]||null;revealed=false;
  retryControls();$('check-due').hidden=unknownSession!==null;
  $('check-due').textContent=practice?'처음부터 다시 연습':'다시 확인';
  $('reveal').hidden=true;$('rating-area').hidden=true;
  $('reveal').textContent='정답 확인';$('practice-actions').hidden=!practice;
  $('review-active').hidden=!activeCard;$('review-empty').hidden=Boolean(activeCard);
  $('practice-previous').disabled=busy||practiceIndex===0;
  $('practice-next').disabled=busy||!activeCard;
  $('review-progress').textContent=practice?`연습 ${Math.min(practiceIndex+1,queue.length)} / ${queue.length}장`:`이번에 복습한 카드 ${sessionCount}장`;
  $('review-deck').textContent=studyGroups(cards()).find(g=>g.key===selectedGroup)?.label||'';
  if(!activeCard){
    if(practice&&store){
      $('review-empty-title').textContent=queue.length?'선택한 묶음 연습을 마쳤어요.':'선택한 묶음에 카드가 없어요.';
      $('next-due').textContent=queue.length?`${queue.length}장을 모두 봤어요. 다시 연습하거나 다른 묶음을 골라보세요. 복습 기록과 일정은 그대로예요.`:'다른 묶음을 선택하거나 카드를 추가해보세요.';return;
    }
    if(unknownSession){
      const remaining=studyQueue(cards(),selectedGroup,'unknown').length;
      $('review-empty-title').textContent=remaining?'모아둔 모름 카드를 한 번씩 모두 봤어요.':'모름 카드가 남아 있지 않아요.';
      $('next-due').textContent=remaining?'아직 모르는 카드는 원할 때 다시 꺼내보세요. 24시간이 지나면 오늘 복습에도 포함돼요.':'다음 복습 날짜를 예약했어요. “오늘 복습으로”에서 다른 카드도 공부할 수 있어요.';return;
    }
    $('review-empty-title').textContent=store?'지금 복습할 카드가 없어요.':'먼저 Dropbox를 연결해주세요.';
    const future=cardsInGroup(cards(),selectedGroup).filter(c=>Date.parse(c.schedule.due)>Date.now()).sort((a,b)=>Date.parse(a.schedule.due)-Date.parse(b.schedule.due))[0];
    $('next-due').textContent=future?`다음 복습은 ${dateLabel(future.schedule.due)}예요. 지금 보고 싶다면 위에서 “자유 연습”을 선택하세요.`:store?'다른 묶음을 선택하거나 카드를 추가해보세요.':'연결하면 저장된 카드와 복습 날짜를 불러와요.';return;
  }
  const card=activeCard,front=sources(card,false);
  $('review-card').textContent='카드를 불러오는 중…';
  prepareReview(remaining);
  const current=()=>request===reviewRequest&&owner===store&&view==='review';
  try{
    const urls=await front;if(!current())return;
    showCard($('review-card'),card,urls,false);$('reveal').hidden=false;
  }catch(e){if(!current())return;notice(friendlyError(e),true);activeCard=null;$('review-active').hidden=true;$('review-empty').hidden=false;$('review-empty-title').textContent='첨부파일을 확인해주세요.';$('next-due').textContent='카드 목록에서 해당 카드의 사진·음성을 다시 선택해주세요.';}
}
async function reveal(){
  if(busy||!activeCard)return;
  setBusy(true);
  try{
    const back=!isPractice()||!revealed;
    showCard($('review-card'),activeCard,await sources(activeCard),back);revealed=back;
    if(isPractice()){
      $('reveal').textContent=back?'앞면 보기':'정답 확인';$('rating-area').hidden=true;return;
    }
    const options=reviewOptions(activeCard);for(const b of document.querySelectorAll('[data-rating]'))b.querySelector('small').textContent=b.dataset.rating==='1'?'1일 내 언제든':intervalLabel(options[b.dataset.rating].due);
    $('reveal').hidden=true;$('rating-area').hidden=false;
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
async function grade(rating){
  if(busy||isPractice()||!store||!activeCard||!revealed)return;setBusy(true);
  notice('복습 기록을 저장하고 있어요…');
  try{
    const owner=store;
    const updated=rateCard(activeCard,rating,new Date(),{retryUnknown:unknownSession!==null});
    const next=cards().map(c=>c.id===updated.id?updated:c);
    const result=await store.commit({...store.library,cards:next},{},[updated.id],undefined,{deferNotes:true});
    unknownSession?.delete(updated.id);
    const message=rating===1?'모름 카드로 모아뒀어요. 원할 때 다시 볼 수 있고, 24시간 뒤에는 오늘 복습에도 포함돼요.':`복습 기록을 저장했어요. 다음 복습: ${dateLabel(updated.schedule.due)}`;
    sessionCount++;saved(result,message,{review:true});
    const savedNotice=noticeVersion;
    const reportNotes=notes=>{if(store===owner)noteWarnings(notes,noticeVersion===savedNotice);};
    if(result.notes)void result.notes.then(reportNotes,error=>reportNotes({warnings:[{message:error.message}]}));
    await showNextReview();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
function movePractice(step){
  if(busy||!store||!isPractice())return;
  practiceIndex=Math.max(0,Math.min(practiceIndex+step,cardsInGroup(cards(),selectedGroup).length));
  void showNextReview();
}

$('connect').addEventListener('click',()=>connect());$('reconnect').addEventListener('click',()=>connect(true));$('reload').addEventListener('click',reload);
$('connect-dropbox').addEventListener('click',connectCloud);
$('disconnect-dropbox').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);
  try{
    await store?.flushNotes?.();cloud?.disconnect();connectionEpoch++;
    if(store?.kind==='dropbox'){store=null;clearMediaCache();activeCard=null;unknownSession=null;renderLibrary();if(view==='review')showNextReview();}
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
  }catch(e){notice(friendlyError(e),true);}finally{event.target.value='';setBusy(false);}
});
async function importBundle(append=false){
  if(busy||store?.kind!=='dropbox')return;
  if(dirty){notice('먼저 입력 중인 카드를 저장하거나 입력을 취소해 주세요.',true);return;}
  setBusy(true);
  try{
    notice('백업 파일의 내용을 확인하고 있어요.');
    const files=await parseBundle($('bundle-data').value);
    const progress=(done,total)=>notice(`Dropbox에 저장하고 확인 중… ${done} / ${total}`);
    const result=append ? await store.appendEntries(files,progress) : await store.importEntries(files,progress);
    $('bundle-data').value='';$('bundle-panel').open=false;
    clearMediaCache();updateDecks();renderLibrary();
    if(append)saved(result,`새 카드 ${result.added}장을 추가했어요. 중복 ${result.skipped}장은 건너뛰었고 기존 카드와 복습 기록은 유지했어요.`);
    else notice(`카드 ${result.cards}장, 파일 ${result.files}개를 Dropbox에 옮겨 검증했어요. 원본은 그대로 유지합니다.`);
    if(view==='review')await showNextReview();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
$('fill-image-bundle').addEventListener('click',async()=>{
  if(busy||store?.kind!=='dropbox')return;
  if(dirty){notice('먼저 입력 중인 카드를 저장하거나 입력을 취소해 주세요.',true);return;}
  setBusy(true);
  try{
    const file=$('image-bundle-file').files[0];
    if(file&&file.size>52428800)throw new Error('이미지 묶음 파일은 50MB 이하로 선택해 주세요.');
    notice('이미지 묶음의 내용을 확인하고 있어요.');
    const files=await parseBundle(file?await file.text():$('bundle-data').value);
    const patch=await prepareImagePatch(store.library,files);
    for(const blob of Object.values(patch.uploads)){const image=await createImageBitmap(blob);image.close();}
    const result=patch.ids.length?await store.commit(patch.next,patch.uploads,patch.ids,(done,total)=>notice(`이미지를 저장하고 확인 중… ${done} / ${total}`)):{warnings:[]};
    $('bundle-data').value='';$('bundle-panel').open=false;
    clearMediaCache();renderLibrary();
    $('image-bundle-file').value='';
    saved(result,`카드 ${patch.ids.length}장에 이미지를 채웠어요. 이미 그림이 있는 ${patch.skipped}장은 유지했어요.`);
    if(view==='review')await showNextReview();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
});
$('import-bundle').addEventListener('click',()=>importBundle(false));
$('append-bundle').addEventListener('click',()=>importBundle(true));
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{if(b.dataset.view==='add'&&view!=='add')resetEditor();switchView(b.dataset.view);});
for(const b of document.querySelectorAll('[data-open-add]'))b.addEventListener('click',()=>switchView('add'));
$('search').addEventListener('input',renderLibrary);
for(const id of ['deck-filter','review-group'])$(id).addEventListener('change',()=>chooseGroup($(id).value));
$('review-mode').addEventListener('change',()=>startReview());
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
$('reveal').addEventListener('click',reveal);$('check-due').addEventListener('click',()=>isPractice()?startReview():showNextReview());
$('practice-previous').addEventListener('click',()=>movePractice(-1));$('practice-next').addEventListener('click',()=>movePractice(1));
$('review-unknown').addEventListener('click',()=>startReview(true));$('review-normal').addEventListener('click',()=>startReview());
for(const b of document.querySelectorAll('[data-rating]'))b.addEventListener('click',()=>grade(Number(b.dataset.rating)));
$('repair-notes').addEventListener('click',async()=>{if(!store||busy)return;setBusy(true);try{const result=await store.exportNotes();$('repair-notes').hidden=result.warnings.length===0;saved(result,'읽기용 노트를 다시 저장했어요.');}catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}});
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(view!=='review'||busy||$('detail-dialog').open||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){if(e.target.closest('button,a,summary'))return;e.preventDefault();if(!revealed||isPractice())reveal();}else if(!isPractice()&&revealed&&/^[1-4]$/.test(e.key))grade(Number(e.key));});
setInterval(()=>{if(store&&!busy)updateStats();void refreshCloud();},30000);
window.addEventListener('pageshow',()=>void refreshCloud());
window.addEventListener('online',()=>void refreshCloud());
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void refreshCloud();});
window.addEventListener('storage',async event=>{
  if(event.key!=='saymore.dropbox.auth.v1'||!cloud)return;
  controls();
  if(cloud.connected&&!busy&&!dirty){const epoch=++connectionEpoch;setBusy(true);try{await loadCloud(epoch);}catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}}
  else if(!cloud.connected)notice('이 브라우저의 Dropbox 연결이 해제되었어요. 다시 연결하면 저장된 기록을 읽을 수 있어요.');
});
$('browser-support').textContent='Dropbox 저장은 아이폰 Safari와 맥 Chrome에서 사용할 수 있어요. 사진·음원도 내 Dropbox에 저장해요.';
resetEditor();renderLibrary();
if(location.hash==='#add')switchView('add',true);else if(location.hash==='#review')switchView('review',true);
async function restoreConnection(){
 try{cloud=await openDropbox();if(cloud.connected){const epoch=++connectionEpoch;setBusy(true);try{await loadCloud(epoch);}finally{setBusy(false);}return;}}
 catch(e){notice(friendlyError(e),true);}
 if(supported)rememberedFolder().then(async folder=>{
  if(!folder||connectionEpoch)return;cachedFolder=folder;
  if(await folder.queryPermission({mode:'readwrite'})==='granted'&&!connectionEpoch){setBusy(true);try{await loadFolder(folder,0);}catch(e){notice(friendlyError(e),true);$('reconnect').hidden=false;}finally{setBusy(false);}}
  else if(!connectionEpoch)$('reconnect').hidden=false;
 }).catch(()=>{/* Re-selecting the folder works when the browser cannot retain handles. */});
 controls();
}
void restoreConnection();
