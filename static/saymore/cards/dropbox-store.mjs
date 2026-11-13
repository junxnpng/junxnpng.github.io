import {copy,newLibrary,parseLibrary,renderNote} from './model.mjs?v=5';
const prefix='/cards';
const mediaPattern=/^media\/[0-9a-f-]{36}\.(jpg|png|webp|mp3)$/;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function eachLimited(items,action){
  let index=0,failed=null;
  const worker=async()=>{while(!failed&&index<items.length){const item=items[index++];try{await action(item);}catch(error){failed=error;}}};
  await Promise.all([worker(),worker(),worker()]);
  if(failed)throw failed;
}
const collision=()=>Error('같은 카드가 다른 기기에서도 바뀌었어요. 입력은 그대로 남겼습니다. 저장된 내용 다시 읽기 전에 필요한 입력을 복사해 주세요.');

export function mergeLibraries(base,local,remote){
  if(base.id!==local.id||base.id!==remote.id)throw Error('다른 카드 보관함입니다. 기존 기록을 덮어쓰지 않았습니다.');
  const before=new Map(base.cards.map(c=>[c.id,c])),ours=new Map(local.cards.map(c=>[c.id,c])),theirs=new Map(remote.cards.map(c=>[c.id,c]));
  const merged=new Map(theirs);
  for(const id of new Set([...before.keys(),...ours.keys()])){
    const old=before.get(id),next=ours.get(id),current=theirs.get(id);
    if(same(old,next))continue;
    if(!same(old,current)&&!same(next,current))throw collision();
    if(next)merged.set(id,copy(next));else merged.delete(id);
  }
  return {...copy(remote),cards:[...merged.values()]};
}

// Answers are written to a small journal file instead of rewriting the whole library each time.
// library.json is the full snapshot; journal.json holds the cards changed since that snapshot.
// What the app works with is the snapshot with the journal laid over it.
//
// Every change goes through journal.json, whose Dropbox revision check puts the devices in one order.
// Folding the journal into the snapshot adds nothing new, so it can fail or overlap with another
// device's answer at any point without losing anything: each journal entry lists the versions of the
// card it came from, and it is applied only on top of one of those.
const libraryPath=`${prefix}/library.json`,journalPath=`${prefix}/journal.json`;
export const journalLimit=80;      // changed cards the journal may hold before it is folded into the snapshot
export const historyLimit=100;     // ...or versions of one card, when the same few cards are answered over and over
const backupEveryMs=7*864e5;       // a copy of the snapshot is kept at most once a week
const emptyJournal=()=>({revision:0,backupAt:null,entries:[],removed:[],conflicts:[]});
const meta=library=>{const {cards,revision,updatedAt,...rest}=library;return JSON.stringify(rest);};
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
// A short fingerprint of a card's whole content, the same whatever order its fields were written in.
export function fingerprint(card){
  const text=JSON.stringify(stable(card));
  let h1=0xdeadbeef,h2=0x41c6ce57;
  for(let i=0;i<text.length;i++){const ch=text.charCodeAt(i);h1=Math.imul(h1^ch,2654435761);h2=Math.imul(h2^ch,1597334677);}
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(36);
}

// In a list of earlier versions, this stands for "there was no such card".
const none='-';
const sameConflict=(a,b)=>a.card&&b.card?a.card.id===b.card.id&&fingerprint(a.card)===fingerprint(b.card):Boolean(a.removed)&&a.removed===b.removed;
// Lays the journal over the snapshot. An entry is applied when the snapshot still holds one of the
// versions it was made from; it is dropped when the snapshot already has it (the journal was folded
// in but could not be emptied). Anything else means the card was changed in two places that never
// saw each other: the snapshot's version stays, and the entry is kept under `conflicts`, never discarded.
export function applyJournal(library,journal,at=new Date().toISOString()){
  if(!journal.entries.length&&!journal.removed.length&&!journal.conflicts.length&&!journal.revision)return {library,journal};
  const byId=new Map(library.cards.map(c=>[c.id,c])),order=library.cards.map(c=>c.id);
  const entries=[],removed=[],clashes=[];
  for(const entry of journal.entries){
    const {card,parents}=entry,old=byId.get(card.id);
    if(old&&fingerprint(old)===fingerprint(card))continue;
    const from=parents.lastIndexOf(old?fingerprint(old):none);
    if(from<0){clashes.push({card,at});continue;}                 // changed here; changed or deleted there
    if(!old)order.push(card.id);
    byId.set(card.id,card);entries.push({card,parents:parents.slice(from)});
  }
  for(const entry of journal.removed){
    const old=byId.get(entry.id);
    if(!old)continue;
    const from=entry.parents.lastIndexOf(fingerprint(old));
    if(from<0){clashes.push({removed:entry.id,at});continue;}     // deleted here, changed there
    byId.delete(entry.id);removed.push({...entry,parents:entry.parents.slice(from)});
  }
  // A clash is kept once, and let go only when the library has since come to hold that very version.
  const conflicts=[];
  for(const clash of [...journal.conflicts,...clashes]){
    const now=byId.get(clash.card?clash.card.id:clash.removed);
    if(clash.card?now&&fingerprint(now)===fingerprint(clash.card):!now)continue;
    if(!conflicts.some(kept=>sameConflict(kept,clash)))conflicts.push(clash);
  }
  return {library:{...library,revision:library.revision+journal.revision,cards:order.filter(id=>byId.has(id)).map(id=>byId.get(id))},
    journal:{...journal,entries,removed,conflicts}};
}
function parseJournal(raw,library){
  let journal;
  try{journal=JSON.parse(raw);}catch{journal=null;}
  const date=value=>typeof value==='string'&&!Number.isNaN(Date.parse(value)),id=value=>typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value);
  const prints=value=>Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.length<=20);
  if(journal?.format!=='saymore-journal'||journal.version!==1||!Number.isInteger(journal.revision)||journal.revision<0
    ||!Array.isArray(journal.entries)||journal.entries.length>10000||journal.entries.some(e=>!e?.card||!prints(e.parents))
    ||!Array.isArray(journal.removed)||journal.removed.some(r=>!id(r?.id)||!prints(r.parents)||!date(r.at))
    ||!Array.isArray(journal.conflicts)||journal.conflicts.some(c=>!date(c?.at)||!(c.card||id(c.removed))))throw Error('최근 복습 기록 파일(journal.json)을 읽지 못했습니다. 기존 기록을 덮어쓰지 않았습니다.');
  // Each card is checked on its own: two clashes may concern the same card.
  const card=value=>parseLibrary(JSON.stringify({...library,cards:[value]})).cards[0];
  const conflicts=journal.conflicts.map(c=>c.card?{card:card(c.card),at:c.at}:{removed:c.removed,at:c.at});
  // Entries left over from a library that was replaced do not apply; clashes set aside are still kept.
  if(journal.libraryId!==library.id)return {...emptyJournal(),conflicts,snapshotRev:null};
  return {revision:journal.revision,backupAt:date(journal.backupAt)?journal.backupAt:null,snapshotRev:typeof journal.snapshotRev==='string'?journal.snapshotRev:null,
    entries:journal.entries.map(e=>({card:card(e.card),parents:[...e.parents]})),
    removed:journal.removed.map(r=>({id:r.id,parents:[...r.parents],at:r.at})),conflicts};
}
const serializeJournal=(library,snapshotRev,journal)=>JSON.stringify({format:'saymore-journal',version:1,libraryId:library.id,snapshotRev,revision:journal.revision,
  updatedAt:new Date().toISOString(),backupAt:journal.backupAt,entries:journal.entries,removed:journal.removed,conflicts:journal.conflicts})+'\n';
// What turns `base` into `next`: the cards that are new or different, and the ids that are gone.
function delta(base,next){
  const before=new Map(base.cards.map(c=>[c.id,c])),seen=new Set(),cards=[];
  for(const card of next.cards){
    seen.add(card.id);
    const old=before.get(card.id);
    if(old!==card&&!(old&&same(old,card)))cards.push(card);
  }
  return {cards,removed:base.cards.filter(c=>!seen.has(c.id)).map(c=>c.id)};
}
// Adds a change made on top of `before` (the library as it stood) to the journal. An entry keeps the
// fingerprints of every earlier version of its card since the snapshot, oldest first; a card that
// did not exist yet (or was deleted in between) is marked by `none`.
function addToJournal(journal,before,change,at){
  const old=new Map(before.cards.map(c=>[c.id,c])),entry=new Map(journal.entries.map(e=>[e.card.id,e])),gone=new Map(journal.removed.map(r=>[r.id,r]));
  const history=id=>entry.has(id)?[...entry.get(id).parents,fingerprint(entry.get(id).card)]:gone.has(id)?[...gone.get(id).parents,none]:old.has(id)?[fingerprint(old.get(id))]:[none];
  const ids=new Set([...change.cards.map(c=>c.id),...change.removed]);
  return {...journal,revision:journal.revision+1,
    entries:[...journal.entries.filter(e=>!ids.has(e.card.id)),...change.cards.map(card=>({card:copy(card),parents:history(card.id)}))],
    removed:[...journal.removed.filter(r=>!ids.has(r.id)),...change.removed.map(id=>({id,parents:history(id),at}))]};
}
const bytesEqual=async(a,b)=>{
  const [left,right]=await Promise.all([a.arrayBuffer(),b.arrayBuffer()]);
  return left.byteLength===right.byteLength&&new Uint8Array(left).every((v,i)=>v===new Uint8Array(right)[i]);
};

export class DropboxStore{
  // `library` is the parsed snapshot file; this.library is that snapshot with the journal applied.
  constructor(cloud,library,raw,rev,hash=null,journal=emptyJournal(),journalRev=null){
    this.cloud=cloud;this.kind='dropbox';this.folder={name:'Dropbox'};this.writing=false;this.foreign=false;
    this.directoriesReady=null;this.preparedBackups=new Map();this.noteQueue=Promise.resolve();this.pendingNotes=0;
    this.checkedRaw=undefined;
    this._adopt({base:library,raw,rev,hash,journalRev,...applyJournal(library,journal)});
  }
  _adopt({base,raw,rev,hash,journal,journalRev,library}){
    this.base=base;this.raw=raw;this.rev=rev;this.hash=hash;this.journal=journal;this.journalRev=journalRev;this.library=library;
    // An older file that was upgraded while reading has to be written back in full once.
    if(raw!==this.checkedRaw){this.checkedRaw=raw;this.upgrade=raw!==null&&meta(base)!==meta(JSON.parse(raw));}
  }
  // Changes whenever either file does; the app compares it to tell whether another device saved.
  get version(){return `${this.rev}:${this.journalRev}`;}
  // Cards changed in two places that never saw each other. They are kept in journal.json.
  get conflicts(){return this.journal.conflicts.length;}
  // Reads both files. `known` (a store, or a snapshot remembered in the browser) lets an unchanged
  // multi-megabyte snapshot be reused after one small metadata request instead of downloaded again.
  static async read(cloud,known=null){
    const snapshot=async reuse=>{
      const current=reuse?.raw!=null&&reuse.rev&&cloud.metadata?await cloud.metadata(libraryPath):null;
      if(current?.rev&&current.rev===reuse.rev&&(!current.content_hash||!reuse.hash||current.content_hash===reuse.hash))
        return {raw:reuse.raw,rev:reuse.rev,hash:current.content_hash||reuse.hash||null,base:reuse.base||parseLibrary(reuse.raw)};
      const file=await cloud.download(libraryPath),raw=file?await file.text():null;
      return {raw,rev:file?.metadata.rev||null,hash:file?.metadata.content_hash||null,base:raw===null?newLibrary():parseLibrary(raw)};
    };
    const journalFile=cloud.download(journalPath);
    journalFile.catch(()=>{});
    let state=await snapshot(known);
    const file=await journalFile;
    let journal=file&&state.raw!==null?parseJournal(await file.text(),state.base):{...emptyJournal(),snapshotRev:null};
    // The journal names the snapshot it extends. If that is not the one just read, the snapshot may
    // have been replaced between the two downloads: read it once more before laying the journal over it.
    if(journal.snapshotRev&&journal.snapshotRev!==state.rev){
      state=await snapshot(null);
      if(file&&state.raw!==null)journal=parseJournal(await file.text(),state.base);
    }
    const {snapshotRev,...rest}=journal;
    return {...state,journalRev:file?.metadata.rev||null,...applyJournal(state.base,rest)};
  }
  static async open(cloud,known=null){
    const state=await DropboxStore.read(cloud,known);
    const store=new DropboxStore(cloud,state.base,state.raw,state.rev,state.hash);
    store._adopt(state);
    return store;
  }
  // True when another device has saved since this store was read. Two small requests, no download.
  async changed(){
    if(this.foreign||!this.cloud.metadata)return true;
    const [library,journal]=await Promise.all([this.cloud.metadata(libraryPath),this.cloud.metadata(journalPath)]);
    return (library?.rev||null)!==this.rev||(journal?.rev||null)!==this.journalRev;
  }
  directories(){
    if(!this.directoriesReady)this.directoriesReady=(async()=>{
      await this.cloud.mkdir(prefix);
      await Promise.all(['media','notes','backups'].map(name=>this.cloud.mkdir(`${prefix}/${name}`)));
    })().catch(error=>{this.directoriesReady=null;throw error;});
    return this.directoriesReady;
  }
  // Answers go to the journal, so there is no backup to make ahead of one; only the folders.
  prepare(){return this.directories();}
  async _prepare(raw,rev,hash=null){
    await this.directories();
    if(raw===null)return;
    if(!this.preparedBackups.has(rev)){
      const ready=this.backup(raw,rev,hash).catch(error=>{this.preparedBackups.delete(rev);throw error;});
      this.preparedBackups.set(rev,ready);
    }
    await this.preparedBackups.get(rev);
  }
  async immutable(path,blob){
    let metadata;
    try{metadata=await this.cloud.upload(`${prefix}/${path}`,blob);}
    catch(error){
      if(!error.conflict)throw error;
      const existing=await this.cloud.download(`${prefix}/${path}`);
      if(!existing||!await bytesEqual(existing.blob,blob))throw Error('같은 이름의 다른 파일이 Dropbox에 있습니다. 덮어쓰지 않았습니다.');
      return existing.metadata;
    }
    const verified=await this.cloud.download(`${prefix}/${path}`);
    if(!verified||!await bytesEqual(verified.blob,blob))throw Error('Dropbox에 저장한 첨부파일을 검증하지 못했습니다. 원본은 유지합니다.');
    return metadata;
  }
  async readMedia(path){
    if(!mediaPattern.test(path))throw Error('첨부파일 경로를 확인해 주세요.');
    const file=await this.cloud.download(`${prefix}/${path}`);
    if(!file||!file.blob.size||file.blob.size>10*1024*1024)throw Error('첨부파일이 없거나 10MB보다 큽니다.');
    return file.blob;
  }
  // The backup of the file we are about to replace. Dropbox copies it on its side when it can, so a
  // megabyte-sized library is not uploaded and downloaded again for every answer.
  async backup(raw,rev,hash){
    const name=`backups/library-${rev}.json`;
    if(hash&&this.cloud.copy){
      try{
        // If another device saved in between, this copies its newer file; the canonical upload then
        // conflicts on the revision and retries with that file, which gets a backup of its own.
        await this.cloud.copy(`${prefix}/library.json`,`${prefix}/${name}`);return;
      }catch(error){
        if(!error.conflict)throw error;
        if((await this.cloud.metadata(`${prefix}/${name}`))?.content_hash===hash)return;
      }
    }
    await this.immutable(name,new Blob([raw]));
  }
  async commit(next,uploads={},changedIds=[],onProgress=()=>{},{deferNotes=false}={}){
    if(this.writing)throw Error('이 창에서 저장 중입니다. 잠시 기다려 주세요.');
    if(next.id!==this.library.id||next.revision!==this.library.revision)throw collision();
    this.writing=true;
    try{
      const change=delta(this.library,next);
      // Only what changes is checked again; every other card was checked when it was read.
      parseLibrary(JSON.stringify({...next,cards:change.cards}));
      if(new Set(next.cards.map(c=>c.id)).size!==next.cards.length)throw Error('같은 번호의 카드가 두 장 있습니다. 저장하지 않았어요.');
      if(meta(next)!==meta(this.library))throw Error('보관함 설정은 이 화면에서 바꿀 수 없습니다. 저장하지 않았어요.');
      const refs=new Set(next.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
      for(const [path,blob]of Object.entries(uploads))if(!refs.has(path)||!mediaPattern.test(path)||!(blob instanceof Blob)||!blob.size||blob.size>10*1024*1024)throw Error('저장할 첨부파일을 확인해 주세요.');
      await this.directories();
      let done=0;
      const total=Object.keys(uploads).length+new Set(changedIds).size;
      await eachLimited(Object.entries(uploads),async([path,blob])=>{await this.immutable(path,blob);onProgress(++done,total);});
      const oldRefs=new Set(this.library.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
      for(const path of refs)if(!oldRefs.has(path)&&!uploads[path])await this.readMedia(path);
      if(this.raw===null)await this._create(next);
      else{
        if(change.cards.length||change.removed.length)await this._commitJournal(next,change);
        // The change is saved at this point. Folding the journal into the snapshot is upkeep: if it
        // cannot be done now (offline, backup failed, another device got there first) the next save tries again.
        const long=this.journal.entries.some(e=>e.parents.length>historyLimit)||this.journal.removed.some(r=>r.parents.length>historyLimit);
        if(!this.foreign&&(this.upgrade||long||this.journal.entries.length+this.journal.removed.length>journalLimit))await this._fold().catch(()=>{});
      }
      const notes=this.queueNotes(changedIds,()=>onProgress(++done,total));
      return deferNotes?{warnings:[],notes}:await notes;
    }finally{this.writing=false;}
  }
  // The very first save: there is no library file yet, so this one writes it.
  async _create(next){
    const snapshot=parseLibrary(JSON.stringify({...next,revision:next.revision+1,updatedAt:new Date().toISOString()}));
    const raw=JSON.stringify(snapshot)+'\n';
    let saved;
    try{saved=await this.cloud.upload(libraryPath,raw,{rev:null});}
    catch(error){if(error.conflict)throw Error('Dropbox에 다른 카드 기록이 방금 생겼습니다. 저장된 내용을 다시 읽은 뒤 저장해 주세요.');throw error;}
    this._adopt({base:snapshot,raw,rev:saved.rev,hash:saved.content_hash||null,journal:{...this.journal,revision:0,entries:[],removed:[]},journalRev:this.journalRev,library:snapshot});
  }
  // Every other save: one small upload that adds the changed cards to the journal.
  async _commitJournal(next,change){
    let before=this.library,journal=this.journal,journalRev=this.journalRev,merged=next,state=null;
    for(let attempt=0;attempt<3;attempt++){
      const at=new Date().toISOString(),updated=addToJournal(journal,before,change,at);
      let saved;
      // Dropbox's revision check makes a separate read unnecessary unless another device wrote first.
      try{saved=await this.cloud.upload(journalPath,serializeJournal(merged,state?state.rev:this.rev,updated),{rev:journalRev});}
      catch(error){
        if(!error.conflict||attempt===2)throw error;
        state=await DropboxStore.read(this.cloud,this);
        if(state.raw===null)throw Error('Dropbox의 보관함 파일이 없어졌습니다. 기존 기록을 새 파일로 덮어쓰지 않았습니다.');
        merged=mergeLibraries(this.library,next,state.library);
        change=delta(state.library,merged);before=state.library;journal=state.journal;journalRev=state.journalRev;
        continue;
      }
      const base=state||this;
      this._adopt({base:base.base,raw:base.raw,rev:base.rev,hash:base.hash,journal:updated,journalRev:saved.rev,
        library:{...merged,revision:this.library.revision+1,updatedAt:at}});
      if(state)this.foreign=false;
      return;
    }
  }
  // Rewrites library.json with the journal folded in, then empties the journal. It writes exactly
  // what the two files already say, so stopping after either step leaves the same library behind.
  async _fold(){
    const at=new Date(),journal=this.journal;
    const snapshot=parseLibrary(JSON.stringify({...this.library,revision:this.library.revision+1,updatedAt:at.toISOString()}));
    let backupAt=journal.backupAt;
    if(!(Date.parse(backupAt)>at.getTime()-backupEveryMs)){await this._prepare(this.raw,this.rev,this.hash);backupAt=at.toISOString();}
    const raw=JSON.stringify(snapshot)+'\n';
    let saved;
    try{saved=await this.cloud.upload(libraryPath,raw,{rev:this.rev});}
    catch(error){if(error.conflict)this.foreign=true;throw error;}   // someone else rewrote it: read again before the next fold
    const emptied={...emptyJournal(),backupAt,conflicts:journal.conflicts};
    let journalRev=this.journalRev;
    // If this fails the old entries stay in journal.json; they match the new snapshot and are skipped when read.
    try{journalRev=(await this.cloud.upload(journalPath,serializeJournal(snapshot,saved.rev,emptied),{rev:journalRev})).rev;}
    catch(error){if(error.conflict)this.foreign=true;}
    this.preparedBackups.clear();
    this._adopt({base:snapshot,raw,rev:saved.rev,hash:saved.content_hash||null,journal:emptied,journalRev,library:snapshot});
  }
  async _export(ids,onProgress=()=>{}){
    const warnings=[];
    await eachLimited([...new Set(ids)],async id=>{
      const card=this.library.cards.find(c=>c.id===id);if(!card)return;
      try{
        const path=`${prefix}/notes/${id}.md`;
        const previous=await this.cloud.download(path);
        const note=renderNote(card,previous?await previous.text():'');
        await this.cloud.upload(path,note,{rev:previous?.metadata.rev||null});
      }catch(error){warnings.push({id,message:error.message});}
      onProgress();
    });
    return {warnings};
  }
  queueNotes(ids,onProgress){
    this.pendingNotes++;
    const run=()=>this._export(ids,onProgress);
    this.noteQueue=this.noteQueue.then(run,run).finally(()=>{this.pendingNotes--;});
    return this.noteQueue;
  }
  async flushNotes(){await this.noteQueue;}
  async exportNotes(){return this.queueNotes(this.library.cards.map(c=>c.id));}

  async appendEntries(files,onProgress=()=>{}){
    if(this.writing)throw Error('저장 중입니다. 잠시 기다려 주세요.');
    const entries=new Map();
    for(const {path,blob}of files){
      if(typeof path!=='string'||!(blob instanceof Blob)||!blob.size||blob.size>50*1024*1024||entries.has(path)||(path!=='library.json'&&!mediaPattern.test(path)))throw Error('새 덱의 파일이나 경로를 확인해 주세요.');
      entries.set(path,blob);
    }
    if(!entries.has('library.json'))throw Error('새 덱에 library.json이 없습니다.');
    const incoming=parseLibrary(await entries.get('library.json').text());
    const existing=new Set(this.library.cards.map(c=>c.id));
    const added=incoming.cards.filter(c=>!existing.has(c.id));
    const refs=new Set(added.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
    // A new card may reuse a picture or recording that a card already in the library holds; that file is not sent again.
    const held=new Set(this.library.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
    for(const path of refs)if(entries.has(path)?entries.get(path).size>10*1024*1024:!held.has(path))throw Error('새 덱의 첨부파일이 없거나 너무 큽니다. 기존 카드는 그대로 유지합니다.');
    if(!added.length)return {added:0,skipped:incoming.cards.length,warnings:[]};
    const uploads=Object.fromEntries([...refs].filter(path=>entries.has(path)).map(path=>[path,entries.get(path)]));
    // Nothing here ever deletes an attachment; if cleanup is added, count every card that uses a path first.
    for(const path of refs)if(!entries.has(path))await this.readMedia(path);
    const result=await this.commit({...copy(this.library),cards:[...copy(this.library.cards),...added]},uploads,added.map(c=>c.id),onProgress);
    const stored=await DropboxStore.read(this.cloud,this);
    const readBack=stored.raw!==null&&stored.library;
    if(!readBack||added.some(c=>!readBack.cards.some(saved=>saved.id===c.id)))throw Error('새 덱 저장 후 확인하지 못했습니다. 저장된 내용 다시 읽기로 확인해 주세요.');
    return {...result,added:added.length,skipped:incoming.cards.length-added.length};
  }

  async importFiles(files,onProgress=()=>{}){
    return this.importEntries(files.map(file=>({path:file.webkitRelativePath?file.webkitRelativePath.split('/').slice(1).join('/'):file.name,blob:file})),onProgress);
  }
  async importEntries(files,onProgress=()=>{}){
    if(this.writing)throw Error('저장 중입니다. 잠시 기다려 주세요.');
    const entries=new Map();
    for(const {path,blob:file} of files){
      if(typeof path!=='string'||!(file instanceof Blob))throw Error('가져올 파일을 확인해 주세요.');
      if(path.split('/').some(p=>p.startsWith('.')))continue;
      if(!/^(library(?:\.backup)?\.json|notes\/[0-9a-f-]{36}\.md|media\/[0-9a-f-]{36}\.(mp3|jpg|png|webp)|IPA-학습-안내\.md|IPA-음원-출처\.(md|json))$/.test(path)||entries.has(path)||!file.size||file.size>50*1024*1024)throw Error('SayMore의 카드 폴더를 선택해 주세요. 지원하지 않는 파일이 있습니다.');
      entries.set(path,file);
    }
    const source=entries.get('library.json');
    if(!source)throw Error('선택한 폴더에 library.json이 없습니다.');
    const raw=await source.text(),library=parseLibrary(raw);
    const refs=new Set(library.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
    for(const path of refs)if(!entries.has(path)||entries.get(path).size>10*1024*1024)throw Error('카드에 연결된 첨부파일이 없거나 너무 큽니다. 원본 폴더를 확인해 주세요.');
    if(entries.has('library.backup.json'))parseLibrary(await entries.get('library.backup.json').text());
    // Compared with what is really stored: the library file with any journal applied.
    const remote=await DropboxStore.read(this.cloud);
    if(remote.raw!==null&&(remote.library.cards.length||remote.journal.entries.length||remote.journal.removed.length)&&!(same(remote.library.cards,library.cards)&&meta(remote.library)===meta(library)))throw Error('Dropbox에 다른 카드 기록이 이미 있습니다. 가져오기로 덮어쓰지 않았습니다.');
    this.writing=true;
    try{
      await this.flushNotes();
      await this.directories();
      let done=0;
      const rest=[...entries].filter(([path])=>path!=='library.json');
      // A bounded queue keeps large audio collections from exhausting requests.
      let index=0,failed=null;
      const worker=async()=>{while(!failed&&index<rest.length){const [path,blob]=rest[index++];try{await this.immutable(path,blob);onProgress(++done,entries.size);}catch(error){failed=error;}}};
      await Promise.all([worker(),worker(),worker()]);
      if(failed)throw failed;
      // Another device may have saved to the journal while the attachments were uploading.
      if(((await this.cloud.download(journalPath))?.metadata.rev||null)!==remote.journalRev)throw Error('가져오는 동안 다른 기기에서 저장했습니다. 덮어쓰지 않았어요. 다시 시도해 주세요.');
      const saved=await this.cloud.upload(`${prefix}/library.json`,raw,{rev:remote.rev});
      // Read back the canonical bytes before telling the user migration succeeded.
      const verified=await this.cloud.download(`${prefix}/library.json`);
      if(!verified||!same(parseLibrary(await verified.text()),parseLibrary(raw)))throw Error('업로드 후 보관함 검증을 마치지 못했습니다. 원본 폴더는 그대로 유지합니다.');
      // The journal is left alone: nothing in it differs from the file just written.
      this._adopt(await DropboxStore.read(this.cloud));
      onProgress(entries.size,entries.size);
      return {cards:library.cards.length,files:entries.size};
    }finally{this.writing=false;}
  }
}
