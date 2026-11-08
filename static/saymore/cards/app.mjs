import {newCard, editCard, rateCard, reviewOptions, dueCards, dateLabel, intervalLabel, ratings} from './model.mjs';
import {FolderStore, rememberedFolder, friendlyError} from './storage.mjs';
import {el, showCard} from './view.mjs';

const $=id=>document.getElementById(id);
let store=null, cachedFolder=null, view='library', busy=false, dirty=false, editedId=null, previewBack=false;
let draftMedia={image:null,audio:null}, activeCard=null, revealed=false, sessionCount=0, detailCard=null, detailBack=false;
let connectionEpoch=0, lastSaved='', mediaCache=new Map(), draftURLs=new Set();
const inputs=['front','answer','ipa','sentence','memory','tags'];
const supported=typeof window.showDirectoryPicker==='function';

function notice(message,error=false){$('notice').textContent=message;$('notice').hidden=!message;$('notice').classList.toggle('error',error);}
function cards(){return store?.library.cards || [];}
function controls(){
  for(const button of document.querySelectorAll('button'))button.disabled=busy;
  for(const input of $('card-form').querySelectorAll('input,textarea,select'))input.disabled=busy;
  $('connect').disabled=busy||!supported;
  $('save-next').disabled=$('save-list').disabled=busy||!store;
  $('save-next').hidden=Boolean(editedId);
  $('save-help').textContent=store ? '저장하면 카드와 복습 일정이 옵시디언 폴더에 남아요.' : '먼저 위의 폴더 연결을 눌러주세요. 입력한 내용은 그대로 남아요.';
  $('reload').hidden=!store;
  $('connection').textContent=store ? `${store.folder.name} 폴더 연결됨` : '폴더 연결 전';
  $('connection').classList.toggle('connected',Boolean(store));
  $('connect').textContent=store ? '다른 폴더 연결':'폴더 연결';
  $('storage-copy').textContent=store ? `카드·복습 날짜·기록을 이 폴더에 저장해요.${lastSaved ? ' 마지막 저장 '+lastSaved : ''}` : '옵시디언 보관함을 선택하면 SayMore/카드 폴더를 사용해요.';
}
function setBusy(value){busy=value;controls();}
function updateStats(){
  $('total-count').textContent=cards().length;
  $('new-count').textContent=cards().filter(c=>c.schedule.state===0).length;
  $('due-count').textContent=store ? dueCards(store.library).filter(c=>c.schedule.state!==0).length : 0;
}
function updateDecks(){
  const selected=$('deck-filter').value;
  const decks=[...new Set(cards().map(c=>c.deck))].sort((a,b)=>a.localeCompare(b));
  $('deck-filter').replaceChildren(new Option('모든 덱',''),...decks.map(d=>new Option(d,d)));
  $('deck-filter').value=decks.includes(selected)?selected:'';
  $('known-decks').replaceChildren(...decks.map(d=>new Option(d,d)));
}
function renderLibrary(){
  updateStats();
  const q=$('search').value.trim().toLocaleLowerCase(), deck=$('deck-filter').value;
  const list=cards().filter(c=>(!deck||c.deck===deck)&&(!q||[c.answer,c.front,c.sentence,c.memory,c.deck,...c.tags].join(' ').toLocaleLowerCase().includes(q)));
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
function clearMediaCache(){for(const url of mediaCache.values())URL.revokeObjectURL(url);mediaCache.clear();}
function clearDraft(){for(const url of draftURLs)URL.revokeObjectURL(url);draftURLs.clear();draftMedia={image:null,audio:null};}
async function source(path){
  if(!mediaCache.has(path))mediaCache.set(path,URL.createObjectURL(await store.readMedia(path)));
  return mediaCache.get(path);
}
async function sources(card){
  const urls={};for(const type of ['image','audio'])if(card[type])urls[type]=await source(card[type].path);return urls;
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
  if(view==='library'){renderLibrary();}
  if(view==='add'){renderPreview();controls();}
  if(view==='review'){sessionCount=0;activeCard=null;showNextReview();}
  return true;
}
async function loadFolder(folder,epoch){
  const loaded=await FolderStore.open(folder);
  if(epoch!==connectionEpoch)return;
  store=loaded;clearMediaCache();lastSaved='';activeCard=null;
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
  try{await loadFolder(store.folder,epoch);if(dirty)notice('최신 카드와 기록을 불러왔어요. 입력 중인 내용은 그대로 있어요. 검토한 뒤 저장해주세요.');}
  catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}
function saved(result,message){
  lastSaved=dateLabel(new Date().toISOString());updateDecks();renderLibrary();
  $('repair-notes').hidden=result.warnings.length===0;
  notice(result.warnings.length ? '카드와 복습 기록은 저장했어요. 옵시디언 노트 일부는 갱신하지 못했어요. “옵시디언 노트 다시 저장”으로 다시 시도해주세요.' : message, result.warnings.length>0);
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
    const message=`${card.answer.slice(0,80)} 카드를 폴더에 저장했어요.`;
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
  for(const key of inputs)$(key).value=key==='tags'?card.tags.join(' '):card[key];
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
  activeCard=store ? dueCards(store.library,new Date(),$('deck-filter').value)[0] : null;revealed=false;
  $('review-active').hidden=!activeCard;$('review-empty').hidden=Boolean(activeCard);
  $('review-progress').textContent=`이번에 복습한 카드 ${sessionCount}장`;$('review-deck').textContent=activeCard?.deck || '';
  if(!activeCard){
    $('review-empty-title').textContent=store?'지금 복습할 카드가 없어요.':'먼저 폴더를 연결해주세요.';
    const future=cards().filter(c=>(!$('deck-filter').value||c.deck===$('deck-filter').value)&&Date.parse(c.schedule.due)>Date.now()).sort((a,b)=>Date.parse(a.schedule.due)-Date.parse(b.schedule.due))[0];
    $('next-due').textContent=future?`다음 복습은 ${dateLabel(future.schedule.due)}예요.`:store?'카드를 추가하거나 모든 덱을 선택해보세요.':'폴더에 저장된 카드와 날짜를 읽고 이어서 학습해요.';return;
  }
  try{showCard($('review-card'),activeCard,await sources(activeCard),false);$('reveal').hidden=false;$('rating-area').hidden=true;}
  catch(e){notice(friendlyError(e),true);activeCard=null;$('review-active').hidden=true;$('review-empty').hidden=false;$('review-empty-title').textContent='첨부파일을 확인해주세요.';$('next-due').textContent='카드 목록에서 해당 카드의 사진·음성을 다시 선택해주세요.';}
}
async function reveal(){
  if(busy||!activeCard)return;
  try{
    showCard($('review-card'),activeCard,await sources(activeCard),true);revealed=true;
    const options=reviewOptions(activeCard);for(const b of document.querySelectorAll('[data-rating]'))b.querySelector('small').textContent=intervalLabel(options[b.dataset.rating].due);
    $('reveal').hidden=true;$('rating-area').hidden=false;
  }catch(e){notice(friendlyError(e),true);}
}
async function grade(rating){
  if(busy||!store||!activeCard||!revealed)return;setBusy(true);
  try{
    const updated=rateCard(activeCard,rating);
    const next=cards().map(c=>c.id===updated.id?updated:c);
    const result=await store.commit({...store.library,cards:next},{},[updated.id]);
    sessionCount++;saved(result,`복습 기록을 저장했어요. 다음 복습: ${dateLabel(updated.schedule.due)}`);
    await showNextReview();
  }catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}
}

$('connect').addEventListener('click',()=>connect());$('reconnect').addEventListener('click',()=>connect(true));$('reload').addEventListener('click',reload);
for(const b of document.querySelectorAll('[data-view]'))b.addEventListener('click',()=>{if(b.dataset.view==='add'&&view!=='add')resetEditor();switchView(b.dataset.view);});
for(const b of document.querySelectorAll('[data-open-add]'))b.addEventListener('click',()=>switchView('add'));
$('search').addEventListener('input',renderLibrary);$('deck-filter').addEventListener('change',renderLibrary);
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
$('reveal').addEventListener('click',reveal);$('check-due').addEventListener('click',showNextReview);
for(const b of document.querySelectorAll('[data-rating]'))b.addEventListener('click',()=>grade(Number(b.dataset.rating)));
$('repair-notes').addEventListener('click',async()=>{if(!store||busy)return;setBusy(true);try{const result=await store.exportNotes();saved(result,'옵시디언 노트를 다시 저장했어요.');}catch(e){notice(friendlyError(e),true);}finally{setBusy(false);}});
window.addEventListener('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(view!=='review'||busy||$('detail-dialog').open||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;if(e.code==='Space'){if(e.target.closest('button,a,summary'))return;e.preventDefault();if(!revealed)reveal();}else if(revealed&&/^[1-4]$/.test(e.key))grade(Number(e.key));});
setInterval(()=>{if(store&&!busy)updateStats();},30000);
if(!supported)$('browser-support').textContent='직접 폴더 저장은 맥의 Chrome 또는 Edge에서 지원해요. 이 브라우저에서는 입력 화면과 예시를 미리 볼 수 있어요.';
else $('browser-support').textContent='카드와 첨부파일은 서버로 전송하지 않아요. 보관함 또는 기존 카드 폴더를 선택해주세요.';
resetEditor();renderLibrary();
if(location.hash==='#add')switchView('add',true);else if(location.hash==='#review')switchView('review',true);
if(supported)rememberedFolder().then(async folder=>{
  if(!folder||connectionEpoch)return;cachedFolder=folder;
  if(await folder.queryPermission({mode:'readwrite'})==='granted'&&!connectionEpoch){setBusy(true);try{await loadFolder(folder,0);}catch(e){notice(friendlyError(e),true);$('reconnect').hidden=false;}finally{setBusy(false);}}
  else if(!connectionEpoch)$('reconnect').hidden=false;
}).catch(()=>{/* Re-selecting the folder works when the browser cannot retain handles. */});
