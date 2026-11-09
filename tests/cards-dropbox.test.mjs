import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {newLibrary,newCard,editCard,rateCard,copy} from '../static/saymore/cards/model.mjs';
let api;
if(existsSync('static/saymore/cards/dropbox-store.mjs'))api=await import('../static/saymore/cards/dropbox-store.mjs');
const fields=answer=>({type:'basic',front:'question',answer});

test('edits to different cards on two devices are both retained',()=>{
  assert.ok(api,'Dropbox card storage is not implemented');
  const base=newLibrary();base.cards=[newCard(fields('one')),newCard(fields('two'))];
  const local=copy(base),remote=copy(base);
  local.cards[0]=editCard(local.cards[0],{...local.cards[0],answer:'local'});
  remote.cards[1]=editCard(remote.cards[1],{...remote.cards[1],answer:'remote'});
  const merged=api.mergeLibraries(base,local,remote);
  assert.equal(merged.cards[0].answer,'local');
  assert.equal(merged.cards[1].answer,'remote');
});

test('two reviews of the same card cannot silently discard history',()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const base=newLibrary(now);base.cards=[newCard(fields('one'),now)];
  const local=copy(base),remote=copy(base);
  local.cards[0]=rateCard(base.cards[0],3,new Date('2026-11-09T00:01:00Z'));
  remote.cards[0]=rateCard(base.cards[0],4,new Date('2026-11-09T00:02:00Z'));
  assert.throws(()=>api.mergeLibraries(base,local,remote),/같은 카드/);
  assert.equal(local.cards[0].reviews.length,1);
  assert.equal(remote.cards[0].reviews[0].rating,4);
});

test('failed canonical upload leaves the stored library and its schedule unchanged',async()=>{
  assert.ok(api);
  const library=newLibrary();library.cards=[newCard(fields('original'))];
  const cloud=memoryCloud(library);
  const store=await api.DropboxStore.open(cloud);
  const next=copy(store.library);next.cards[0]=editCard(next.cards[0],{...next.cards[0],answer:'new'});
  cloud.rejectCanonical=true;
  await assert.rejects(store.commit(next,{},[next.cards[0].id]),/offline/);
  assert.equal(store.library.cards[0].answer,'original');
  assert.equal(JSON.parse(await cloud.files.get('/cards/library.json').text()).cards[0].answer,'original');
});

test('a successful cloud commit preserves the entire review log and exports a note',async()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const library=newLibrary(now);library.cards=[newCard(fields('one'),now)];
  const cloud=memoryCloud(library),store=await api.DropboxStore.open(cloud);
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],3,new Date('2026-11-09T00:01:00Z'));
  const result=await store.commit(next,{},[next.cards[0].id]);
  assert.equal(result.warnings.length,0);
  const saved=JSON.parse(await cloud.files.get('/cards/library.json').text());
  assert.equal(saved.cards[0].reviews.length,1);
  assert.equal(saved.cards[0].schedule.due,next.cards[0].schedule.due);
  assert.match(await cloud.files.get(`/cards/notes/${next.cards[0].id}.md`).text(),/기록한 복습: 1회/);
});

test('folder migration preserves card IDs, FSRS state, and all previous reviews',async()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const library=newLibrary(now);library.cards=[rateCard(newCard(fields('one'),now),3,new Date('2026-11-09T00:01:00Z'))];
  const cloud=memoryCloud(newLibrary()),store=await api.DropboxStore.open(cloud);
  const source=new File([JSON.stringify(library)],'library.json');
  Object.defineProperty(source,'webkitRelativePath',{value:'카드/library.json'});
  const result=await store.importFiles([source]);
  assert.equal(result.cards,1);
  assert.deepEqual(store.library,library);
  assert.equal(JSON.parse(await cloud.files.get('/cards/library.json').text()).cards[0].reviews.length,1);
});

test('folder migration refuses to replace an existing different cloud library',async()=>{
  assert.ok(api);
  const old=newLibrary();old.cards=[newCard(fields('keep me'))];
  const cloud=memoryCloud(old),store=await api.DropboxStore.open(cloud);
  const incoming=newLibrary();incoming.cards=[newCard(fields('incoming'))];
  const file=new File([JSON.stringify(incoming)],'library.json');
  Object.defineProperty(file,'webkitRelativePath',{value:'카드/library.json'});
  await assert.rejects(store.importFiles([file]),/다른 카드 기록/);
  assert.equal(JSON.parse(await cloud.files.get('/cards/library.json').text()).cards[0].answer,'keep me');
});

test('adding a deck preserves existing reviews and skips the same IDs on re-import',async()=>{
  const now=new Date('2026-11-09T00:00:00Z');
  const original=rateCard(newCard(fields('keep'),now),3,now);
  const existing={...newLibrary(now),cards:[original]};
  const incoming={...newLibrary(now),cards:[newCard({...fields('new'),deck:'New deck'},now)]};
  const cloud=memoryCloud(existing),store=await api.DropboxStore.open(cloud);
  const files=[{path:'library.json',blob:new Blob([JSON.stringify(incoming)])}];
  const result=await store.appendEntries(files);
  assert.equal(result.added,1);assert.equal(store.library.cards.length,2);
  assert.deepEqual(store.library.cards[0],original);
  const edited=editCard(store.library.cards[1],{...store.library.cards[1],answer:'my correction'},now);
  await store.commit({...store.library,cards:[original,edited]});
  const second=await store.appendEntries(files);
  assert.equal(second.added,0);assert.equal(second.skipped,1);
  assert.equal(store.library.cards[1].answer,'my correction');
  assert.deepEqual(store.library.cards[0],original);
});

test('incomplete deck attachments are rejected before uploading any file',async()=>{
  const original=newLibrary(),cloud=memoryCloud(original),store=await api.DropboxStore.open(cloud);
  const incoming=newLibrary();incoming.cards=[newCard({...fields('new'),image:{path:'media/00000000-0000-0000-0000-000000000001.png',credit:'mine'}})];
  await assert.rejects(store.appendEntries([{path:'library.json',blob:new Blob([JSON.stringify(incoming)])}]),/첨부파일/);
  assert.equal(cloud.files.size,1);
  assert.deepEqual(JSON.parse(await cloud.files.get('/cards/library.json').text()),original);
});

test('adding a deck merges another device review made during import',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),base=newLibrary(now);
  base.cards=[newCard(fields('original'),now)];
  const cloud=memoryCloud(base),store=await api.DropboxStore.open(cloud);
  const remote={...copy(base),cards:[rateCard(base.cards[0],4,now)],revision:1};
  await cloud.upload('/cards/library.json',JSON.stringify(remote),{rev:'1'});
  const incoming=newLibrary(now);incoming.cards=[newCard(fields('added'),now)];
  await store.appendEntries([{path:'library.json',blob:new Blob([JSON.stringify(incoming)])}]);
  assert.deepEqual(store.library.cards[0],remote.cards[0]);
  assert.equal(store.library.cards.length,2);
});

function memoryCloud(library){
  const files=new Map([['/cards/library.json',new Blob([JSON.stringify(library)])]]),revs=new Map([['/cards/library.json','1']]);
  return {files,rejectCanonical:false,mkdir:async()=>{},
    async download(path){const blob=files.get(path);return blob?{blob,metadata:{rev:revs.get(path)},text:()=>blob.text()}:null;},
    async upload(path,data,{rev=null}={}){
      if(path==='/cards/library.json'&&this.rejectCanonical)throw Error('offline');
      if((revs.get(path)||null)!==rev)throw Object.assign(Error('conflict'),{conflict:true});
      files.set(path,data instanceof Blob?data:new Blob([data]));revs.set(path,String(Number(revs.get(path)||0)+1));return {rev:revs.get(path)};
    }
  };
}

test('a prepared review saves its canonical record without waiting for the reading note',async()=>{
  const library=newLibrary();library.cards=[newCard(fields('one'))];
  const cloud=memoryCloud(library),store=await api.DropboxStore.open(cloud);
  await store.prepare();
  const calls=[],download=cloud.download.bind(cloud),upload=cloud.upload.bind(cloud);
  let release;
  const held=new Promise(resolve=>{release=resolve;});
  cloud.download=async path=>{calls.push(path);if(path.includes('/notes/'))await held;return download(path);};
  cloud.upload=async(path,...args)=>{calls.push(path);return upload(path,...args);};
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],3);
  try{
    const result=await Promise.race([
      store.commit(next,{},[next.cards[0].id],undefined,{deferNotes:true}),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('review waited for its reading note')),200))
    ]);
    assert.deepEqual(calls.filter(path=>!path.includes('/notes/')),['/cards/library.json']);
    assert.equal(JSON.parse(await cloud.files.get('/cards/library.json').text()).cards[0].reviews.length,1);
    assert.equal(store.writing,false);
    release();
    assert.deepEqual(await result.notes,{warnings:[]});
    assert.match(await cloud.files.get(`/cards/notes/${next.cards[0].id}.md`).text(),/기록한 복습: 1회/);
  }finally{release();}
});

test('background note writes stay ordered and a failed note does not prevent later exports',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=newLibrary(now);
  library.cards=[newCard(fields('one'),now)];
  const cloud=memoryCloud(library),store=await api.DropboxStore.open(cloud);
  const upload=cloud.upload.bind(cloud);let release,entered;
  const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  let first=true;
  cloud.upload=async(path,...args)=>{
    if(path.includes('/notes/')&&first){first=false;entered();await held;throw Error('note offline');}
    return upload(path,...args);
  };
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],3,now);
  try{
    const firstResult=await Promise.race([
      store.commit(next,{},[next.cards[0].id],undefined,{deferNotes:true}),
      new Promise((_,reject)=>setTimeout(()=>reject(Error('review waited for its reading note')),200))
    ]);
    assert.ok(firstResult.notes,'review must return its background note completion');
    await started;
    const later=copy(store.library);later.cards[0]=rateCard(later.cards[0],3,new Date('2026-11-09T00:10:00Z'));
    const secondResult=await store.commit(later,{},[later.cards[0].id],undefined,{deferNotes:true});
    release();
    assert.equal((await firstResult.notes).warnings.length,1);
    assert.deepEqual(await secondResult.notes,{warnings:[]});
    assert.match(await cloud.files.get(`/cards/notes/${later.cards[0].id}.md`).text(),/기록한 복습: 2회/);
    assert.equal(store.pendingNotes,0);
  }finally{release();}
});

test('a prewarmed backup cannot hide another device review or recreate a deleted library',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=newLibrary(now);
  library.cards=[newCard(fields('one'),now),newCard(fields('two'),now)];
  const cloud=memoryCloud(library),one=await api.DropboxStore.open(cloud),two=await api.DropboxStore.open(cloud);
  await Promise.all([one.prepare(),two.prepare()]);
  const first=copy(one.library);first.cards[0]=rateCard(first.cards[0],3,now);
  await one.commit(first,{},[first.cards[0].id]);
  const second=copy(two.library);second.cards[1]=rateCard(second.cards[1],4,now);
  await two.commit(second,{},[second.cards[1].id]);
  assert.deepEqual(two.library.cards.map(c=>c.reviews.length),[1,1]);
  assert.deepEqual(JSON.parse(await cloud.files.get('/cards/backups/library-2.json').text()).cards.map(c=>c.reviews.length),[1,0]);
  const stale=copy(one.library);stale.cards[1]=rateCard(stale.cards[1],3,now);
  await assert.rejects(one.commit(stale,{},[stale.cards[1].id]),/같은 카드/);
  await two.prepare();
  cloud.download=async path=>path==='/cards/library.json'?null:{blob:cloud.files.get(path),metadata:{rev:'1'},text:()=>cloud.files.get(path).text()};
  cloud.upload=async()=>{throw Object.assign(Error('deleted'),{conflict:true});};
  const missing=copy(two.library);missing.cards[0]=editCard(missing.cards[0],{...missing.cards[0],answer:'edited'});
  await assert.rejects(two.commit(missing),/없어졌습니다/);
});

test('failed backup preparation can be retried and never acknowledges a review early',async()=>{
  const library=newLibrary();library.cards=[newCard(fields('one'))];
  const cloud=memoryCloud(library),store=await api.DropboxStore.open(cloud),upload=cloud.upload.bind(cloud);
  cloud.upload=async(path,...args)=>{if(path.includes('/backups/'))throw Error('backup offline');return upload(path,...args);};
  await assert.rejects(store.prepare(),/backup offline/);
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],3);
  await assert.rejects(store.commit(next),/backup offline/);
  assert.equal(store.library.cards[0].reviews.length,0);
  cloud.upload=upload;
  await store.commit(next);
  assert.equal(store.library.cards[0].reviews.length,1);
  assert.equal(JSON.parse(await cloud.files.get('/cards/backups/library-1.json').text()).cards[0].reviews.length,0);
});
