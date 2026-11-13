import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {newLibrary,newCard,editCard,rateCard,copy} from '../static/saymore/cards/model.mjs';
import {fsrs,generatorParameters} from '../static/saymore/cards/vendor/ts-fsrs.mjs';
let api;
if(existsSync('static/saymore/cards/dropbox-store.mjs'))api=await import('../static/saymore/cards/dropbox-store.mjs');
const fields=answer=>({type:'basic',front:'question',answer});
// What Dropbox holds: the snapshot file with the journal file applied, as a fresh device would read it.
const stored=async cloud=>(await api.DropboxStore.open(cloud)).library;
const text=(cloud,path)=>cloud.files.get(path).text();

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
  assert.equal((await stored(cloud)).cards[0].answer,'original');
  assert.equal(cloud.files.has('/cards/journal.json'),false);
});

test('a successful cloud commit preserves the entire review log and exports a note',async()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const library=newLibrary(now);library.cards=[newCard(fields('one'),now)];
  const cloud=memoryCloud(library),store=await api.DropboxStore.open(cloud);
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],3,new Date('2026-11-09T00:01:00Z'));
  const result=await store.commit(next,{},[next.cards[0].id]);
  assert.equal(result.warnings.length,0);
  const saved=await stored(cloud);
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
  const read=await api.DropboxStore.open(cloud);
  assert.deepEqual(read.library.cards,store.library.cards);
  assert.equal(read.conflicts,0);
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
  const other=await api.DropboxStore.open(cloud);
  const remote={...copy(other.library),cards:[rateCard(base.cards[0],4,now)]};
  await other.commit(remote,{},[base.cards[0].id]);
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
      if((path==='/cards/library.json'||path==='/cards/journal.json')&&this.rejectCanonical)throw Error('offline');
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
    assert.deepEqual(calls.filter(path=>!path.includes('/notes/')),['/cards/journal.json']);
    assert.equal((await stored(cloud)).cards[0].reviews.length,1);
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
    const later=copy(store.library);later.cards[0]=rateCard(later.cards[0],3,new Date(later.cards[0].schedule.due));
    const secondResult=await store.commit(later,{},[later.cards[0].id],undefined,{deferNotes:true});
    release();
    assert.equal((await firstResult.notes).warnings.length,1);
    assert.deepEqual(await secondResult.notes,{warnings:[]});
    assert.match(await cloud.files.get(`/cards/notes/${later.cards[0].id}.md`).text(),/기록한 복습: 2회/);
    assert.equal(store.pendingNotes,0);
  }finally{release();}
});

test('two devices answering different cards keep both; the same card collides; a deleted library is not recreated',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=newLibrary(now);
  library.cards=[newCard(fields('one'),now),newCard(fields('two'),now)];
  const cloud=memoryCloud(library),one=await api.DropboxStore.open(cloud),two=await api.DropboxStore.open(cloud);
  await Promise.all([one.prepare(),two.prepare()]);
  const first=copy(one.library);first.cards[0]=rateCard(first.cards[0],3,now);
  await one.commit(first,{},[first.cards[0].id]);
  const second=copy(two.library);second.cards[1]=rateCard(second.cards[1],4,now);
  await two.commit(second,{},[second.cards[1].id]);
  assert.deepEqual(two.library.cards.map(c=>c.reviews.length),[1,1]);
  assert.deepEqual((await stored(cloud)).cards.map(c=>c.reviews.length),[1,1]);
  const stale=copy(one.library);stale.cards[1]=rateCard(stale.cards[1],3,now);
  await assert.rejects(one.commit(stale,{},[stale.cards[1].id]),/같은 카드/);
  assert.equal((await stored(cloud)).cards[1].reviews[0].rating,4);
  cloud.download=async path=>path==='/cards/library.json'?null:{blob:cloud.files.get(path),metadata:{rev:'1'},text:()=>cloud.files.get(path).text()};
  cloud.upload=async()=>{throw Object.assign(Error('deleted'),{conflict:true});};
  const missing=copy(two.library);missing.cards[0]=editCard(missing.cards[0],{...missing.cards[0],answer:'edited'});
  await assert.rejects(two.commit(missing),/없어졌습니다/);
});

// Changes every card, which is more than the journal holds, so the whole library file is rewritten.
const rewriteAll=store=>({...store.library,cards:store.library.cards.map(c=>editCard(c,{...c,answer:c.answer+'!'}))});
const manyCards=(count,now=new Date('2026-11-09T00:00:00Z'))=>{const library=newLibrary(now);library.cards=Array.from({length:count},(_,i)=>newCard(fields('card '+i),now));return library;};

test('a failed backup never loses the change: it stays in the journal and the rewrite is retried',async()=>{
  const library=manyCards(api.journalLimit+5);
  const cloud=memoryCloud(library),original=await text(cloud,'/cards/library.json'),store=await api.DropboxStore.open(cloud),upload=cloud.upload.bind(cloud);
  cloud.upload=async(path,...args)=>{if(path.includes('/backups/'))throw Error('backup offline');return upload(path,...args);};
  await store.prepare();
  await store.commit(rewriteAll(store));
  assert.equal(store.library.cards[0].answer,'card 0!');
  assert.equal(await text(cloud,'/cards/library.json'),original,'no rewrite without a backup');
  assert.equal((await stored(cloud)).cards.at(-1).answer,`card ${api.journalLimit+4}!`);
  cloud.upload=upload;
  await store.commit({...store.library,cards:store.library.cards.map((c,i)=>i?c:editCard(c,{...c,answer:'again'}))});
  assert.equal(await text(cloud,'/cards/backups/library-1.json'),original);
  assert.equal(JSON.parse(await text(cloud,'/cards/library.json')).cards[0].answer,'again');
  assert.equal(store.journal.entries.length,0);
  assert.deepEqual((await stored(cloud)).cards,store.library.cards);
});

test('an old Dropbox library upgrades on save while its original snapshot and reviews survive',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=newLibrary(now);
  const params=generatorParameters({request_retention:0.9,enable_fuzz:false});
  library.scheduler={name:'FSRS-6',implementation:'ts-fsrs',version:'5.4.2',params};
  const card=newCard(fields('legacy'),now),result=fsrs(params).next(card.schedule,now,3);
  card.schedule=copy(result.card);card.reviews=[{at:now.toISOString(),rating:3,due:result.card.due.toISOString(),log:copy(result.log)}];
  library.cards=[card];
  const cloud=memoryCloud(library),original=await cloud.files.get('/cards/library.json').text();
  const store=await api.DropboxStore.open(cloud);
  assert.equal(await cloud.files.get('/cards/library.json').text(),original);
  const next=copy(store.library);next.cards[0]=rateCard(next.cards[0],1,new Date(card.schedule.due));
  await store.commit(next,{},[card.id]);
  const saved=JSON.parse(await cloud.files.get('/cards/library.json').text());
  assert.equal(saved.scheduler.params.enable_short_term,false);
  assert.equal(saved.scheduler.policy.unknownRetry,'on-demand');
  assert.equal(saved.cards[0].id,card.id);assert.equal(saved.cards[0].reviews.length,2);
  assert.deepEqual(saved.cards[0].reviews[0],card.reviews[0]);
  assert.equal(saved.cards[0].schedule.due,'2026-11-10T00:10:00.000Z');
  assert.equal(await cloud.files.get('/cards/backups/library-1.json').text(),original);
});

function hashingCloud(library){
  const cloud=memoryCloud(library),hashes=new Map(),calls=[];
  const hashOf=async blob=>'h'+(await blob.text()).length+':'+(await blob.text()).slice(-24);
  const download=cloud.download.bind(cloud),upload=cloud.upload.bind(cloud);
  cloud.calls=calls;
  cloud.download=async path=>{calls.push('download '+path);const file=await download(path);if(file)file.metadata.content_hash=await hashOf(file.blob);return file;};
  cloud.upload=async(path,data,options)=>{calls.push('upload '+path.replace(/library-\d+/,'library-N'));const saved=await upload.call(cloud,path,data,options);return {...saved,content_hash:await hashOf(cloud.files.get(path))};};
  cloud.copy=async(from,to)=>{calls.push('copy '+to.replace(/library-\d+/,'library-N'));if(cloud.files.has(to))throw Object.assign(Error('conflict'),{conflict:true});cloud.files.set(to,cloud.files.get(from));return {content_hash:await hashOf(cloud.files.get(to))};};
  cloud.metadata=async path=>{const file=await download(path);return file?{rev:file.metadata.rev,content_hash:await hashOf(file.blob)}:null;};
  return cloud;
}

test('an answer is one small upload to the journal; the library file is rewritten only when the journal is full',async()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const library=manyCards(api.journalLimit+20,now);
  const cloud=hashingCloud(library),original=await text(cloud,'/cards/library.json');
  const store=await api.DropboxStore.open(cloud);
  await store.prepare();await store.prepare();
  const answer=async index=>{
    const next={...store.library,cards:store.library.cards.map((c,i)=>i===index?rateCard(c,3,now):c)};
    cloud.calls.length=0;
    await store.commit(next,{},[next.cards[index].id],undefined,{deferNotes:true});
    await store.flushNotes();
    return cloud.calls.filter(c=>!c.includes('/notes/'));
  };
  assert.deepEqual(await answer(0),['upload /cards/journal.json']);
  assert.equal(await text(cloud,'/cards/library.json'),original,'the library file is not touched by an answer');
  assert.ok((await text(cloud,'/cards/journal.json')).length<original.length/20,'the journal is a small fraction of the library');
  for(let i=1;i<api.journalLimit;i++)assert.deepEqual(await answer(i),['upload /cards/journal.json']);
  assert.equal(store.journal.entries.length,api.journalLimit);
  assert.equal(await store.changed(),false,'its own answers are not mistaken for another device');
  // The next answer is saved to the journal like any other; then the journal is folded into the
  // library file, with a server-side copy of the old file as its backup.
  assert.deepEqual(await answer(api.journalLimit),['upload /cards/journal.json','copy /cards/backups/library-N.json','upload /cards/library.json','upload /cards/journal.json']);
  assert.equal(await text(cloud,'/cards/backups/library-1.json'),original);
  assert.ok(!(await text(cloud,'/cards/library.json')).includes('\n  '),'stored compactly');
  assert.equal(store.journal.entries.length,0);
  assert.equal(await store.changed(),false,'nor is its own rewrite');
  assert.equal(JSON.parse(await text(cloud,'/cards/library.json')).cards.filter(c=>c.reviews.length).length,api.journalLimit+1);
  assert.deepEqual(await answer(api.journalLimit+1),['upload /cards/journal.json']);
  assert.equal((await stored(cloud)).cards.filter(c=>c.reviews.length).length,api.journalLimit+2);
  assert.deepEqual((await stored(cloud)).cards,store.library.cards);
  // A second rewrite in the same week makes no second backup.
  cloud.calls.length=0;
  await store.commit(rewriteAll(store),{},[],undefined,{deferNotes:true});
  assert.deepEqual(cloud.calls,['upload /cards/journal.json','upload /cards/library.json','upload /cards/journal.json']);
  assert.deepEqual((await stored(cloud)).cards,store.library.cards);
});

test('opening again reuses an unchanged library file, and checking for changes downloads nothing',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=manyCards(api.journalLimit+5,now);
  const inner=memoryCloud(library),calls=[];
  const cloud={files:inner.files,mkdir:inner.mkdir,
    download:async path=>{calls.push('download '+path);return inner.download(path);},
    upload:async(path,data,options)=>{calls.push('upload '+path);return inner.upload(path,data,options);},
    metadata:async path=>{calls.push('metadata '+path);return (await inner.download(path))?.metadata||null;}};
  const store=await api.DropboxStore.open(cloud);
  calls.length=0;
  assert.equal(await store.changed(),false);
  assert.deepEqual(calls.sort(),['metadata /cards/journal.json','metadata /cards/library.json']);
  const other=await api.DropboxStore.open(cloud);
  await other.commit({...other.library,cards:other.library.cards.map((c,i)=>i?c:rateCard(c,4,now))},{},[],undefined,{deferNotes:true});
  assert.equal(await store.changed(),true);
  calls.length=0;
  const again=await api.DropboxStore.open(cloud,store);
  assert.deepEqual(calls.sort(),['download /cards/journal.json','metadata /cards/library.json']);
  assert.equal(again.library.cards[0].reviews.length,1);
  assert.notEqual(again.version,store.version);
  assert.deepEqual(again.library.cards,other.library.cards);
  // Once the library file itself has been rewritten, a remembered copy of the old one is not used.
  await other.commit(rewriteAll(other),{},[],undefined,{deferNotes:true});
  calls.length=0;
  const fresh=await api.DropboxStore.open(cloud,{raw:store.raw,rev:store.rev,hash:store.hash});
  assert.ok(calls.includes('download /cards/library.json'));
  assert.deepEqual(fresh.library.cards,other.library.cards);
  assert.equal(fresh.library.cards[1].answer,'card 1!');
});

// Scenarios from review: every one of these once lost or overwrote an answer without an error.
const answerCard=(store,index,rating,at)=>store.commit({...store.library,cards:store.library.cards.map((c,i)=>i===index?rateCard(c,rating,at):c)},{},[]);
const editAnswer=(store,index,answer,at)=>store.commit({...store.library,cards:store.library.cards.map((c,i)=>i===index?editCard(c,{...c,answer},at):c)},{},[]);
const failJournalWrite=(cloud,nth)=>{const upload=cloud.upload.bind(cloud);let seen=0;cloud.upload=async(path,...args)=>{if(path==='/cards/journal.json'&&++seen===nth)throw Error('offline');return upload(path,...args);};return ()=>{cloud.upload=upload;};};

test('a device with a full, out-of-date journal cannot fold its view over another device\'s answer',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(api.journalLimit+20,now));
  const mac=await api.DropboxStore.open(cloud),phone=await api.DropboxStore.open(cloud);
  for(let i=0;i<api.journalLimit;i++)await answerCard(mac,i,3,now);
  await answerCard(phone,90,4,now);                       // conflicts with the journal, re-reads, merges
  assert.equal(phone.library.cards[0].reviews.length,1);
  await assert.rejects(editAnswer(mac,90,'edited on the mac',now),/같은 카드/);
  assert.equal((await stored(cloud)).cards[90].reviews[0].rating,4);
  assert.equal((await stored(cloud)).cards[90].answer,'card 90');
  // the mac reads again and carries on; each answer is still one small upload and no backup piles up
  const fresh=await api.DropboxStore.open(cloud,mac);
  await answerCard(fresh,91,3,now);await answerCard(fresh,92,3,now);
  const read=await stored(cloud);
  assert.deepEqual([90,91,92].map(i=>read.cards[i].reviews.length),[1,1,1]);
  assert.equal(read.cards.filter(c=>c.reviews.length).length,api.journalLimit+3);
  assert.equal([...cloud.files.keys()].filter(path=>path.includes('/backups/')).length,1);
});

test('a rewrite whose journal could not be emptied does not let another device overwrite an edit',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(api.journalLimit+5,now));
  const mac=await api.DropboxStore.open(cloud);
  await answerCard(mac,0,3,now);
  const phone=await api.DropboxStore.open(cloud);
  const restore=failJournalWrite(cloud,2);                // the change is saved; emptying the journal fails
  await mac.commit(rewriteAll(mac),{},[]);
  restore();
  assert.equal(JSON.parse(await text(cloud,'/cards/library.json')).cards[0].answer,'card 0!');
  assert.deepEqual((await stored(cloud)).cards,mac.library.cards);
  await assert.rejects(answerCard(phone,0,4,new Date(mac.library.cards[0].schedule.due)),/같은 카드/);
  const again=await api.DropboxStore.open(cloud,phone);
  await answerCard(again,0,4,new Date(again.library.cards[0].schedule.due));
  const read=await stored(cloud);
  assert.equal(read.cards[0].answer,'card 0!');
  assert.deepEqual(read.cards[0].reviews.map(r=>r.rating),[3,4]);
  assert.equal(again.conflicts,0);
  // the mac, whose journal revision is out of date, also merges instead of overwriting
  await answerCard(mac,1,3,now);
  assert.deepEqual((await stored(cloud)).cards.slice(0,2).map(c=>c.reviews.length),[2,1]);
});

test('reading the library file just before a rewrite and the journal just after it loses nothing',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(api.journalLimit+5,now));
  const mac=await api.DropboxStore.open(cloud);
  for(let i=0;i<api.journalLimit;i++)await answerCard(mac,i,3,now);
  const old=await cloud.download('/cards/library.json');
  await answerCard(mac,api.journalLimit,3,now);           // folds the journal into the library file
  assert.equal(mac.journal.entries.length,0);
  const download=cloud.download.bind(cloud);let stale=true;
  cloud.download=async path=>{if(path==='/cards/library.json'&&stale){stale=false;return old;}return download(path);};
  const phone=await api.DropboxStore.open(cloud);
  assert.equal(phone.library.cards.filter(c=>c.reviews.length).length,api.journalLimit+1);
  await answerCard(phone,0,4,new Date(phone.library.cards[0].schedule.due));
  assert.deepEqual((await stored(cloud)).cards[0].reviews.map(r=>r.rating),[3,4]);
});

test('importing the same library again cannot erase answers held in the journal',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),library=manyCards(3,now),cloud=memoryCloud(library);
  const store=await api.DropboxStore.open(cloud);
  await answerCard(store,0,3,now);
  const file=new File([JSON.stringify(library)],'library.json');
  Object.defineProperty(file,'webkitRelativePath',{value:'카드/library.json'});
  await assert.rejects(store.importFiles([file]),/다른 카드 기록/);
  assert.equal((await stored(cloud)).cards[0].reviews.length,1);
  assert.equal(store.library.cards[0].reviews.length,1);
});

test('a deleted card stays deleted, and an edit from a device with a slow clock is kept',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),earlier=new Date('2026-11-08T23:00:00Z'),cloud=memoryCloud(manyCards(api.journalLimit+5,now));
  const store=await api.DropboxStore.open(cloud),gone=store.library.cards[5].id;
  await answerCard(store,5,3,now);
  const restore=failJournalWrite(cloud,2);
  await store.commit({...store.library,cards:store.library.cards.filter(c=>c.id!==gone).map(c=>editCard(c,{...c,answer:c.answer+'!'}))},{},[]);
  restore();
  let read=await stored(cloud);
  assert.equal(read.cards.some(c=>c.id===gone),false);
  assert.equal(store.library.cards.some(c=>c.id===gone),false);
  assert.equal(read.cards.length,api.journalLimit+4);
  // its clock says an hour ago, which is before the card was last written; the edit still counts
  const other=await api.DropboxStore.open(cloud);
  await editAnswer(other,0,'corrected',earlier);
  assert.ok(Date.parse(other.library.cards[0].updatedAt)<Date.parse(read.cards[0].updatedAt));
  assert.equal((await stored(cloud)).cards[0].answer,'corrected');
});

test('an old copy of the app rewriting the library file: untouched cards keep their journal answers, a clash is kept aside',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(4,now));
  const store=await api.DropboxStore.open(cloud);
  await answerCard(store,0,3,now);await answerCard(store,1,3,now);
  // the old copy knows nothing of the journal: it answers card 0 and card 2 and uploads the whole file
  const before=await cloud.download('/cards/library.json'),file=JSON.parse(await before.text());
  file.cards[0]=rateCard(file.cards[0],1,now);file.cards[2]=rateCard(file.cards[2],4,now);file.revision++;
  await cloud.upload('/cards/library.json',JSON.stringify(file),{rev:before.metadata.rev});
  assert.equal(await store.changed(),true);
  const read=await api.DropboxStore.open(cloud,store);
  assert.deepEqual(read.library.cards.map(c=>c.reviews.map(r=>r.rating)),[[1],[3],[4],[]]);
  assert.equal(read.conflicts,1);
  assert.equal(read.journal.conflicts[0].card.reviews[0].rating,3);
  // the clash is still in journal.json after later saves and a rewrite of the library file
  await read.commit({...read.library,cards:read.library.cards.map((c,i)=>i===3?rateCard(c,3,now):c)},{},[]);
  await read._fold();
  const journal=JSON.parse(await text(cloud,'/cards/journal.json'));
  assert.equal(journal.entries.length,0);
  assert.equal(journal.conflicts.length,1);assert.equal(journal.conflicts[0].card.id,file.cards[0].id);
  assert.deepEqual((await stored(cloud)).cards.map(c=>c.reviews.length),[1,1,1,1]);
  assert.equal((await api.DropboxStore.open(cloud)).conflicts,1);
});

test('a card added and then answered, edited, deleted and added again reads the same on another device',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=memoryCloud(manyCards(2,now));
  const mac=await api.DropboxStore.open(cloud);
  const added=newCard({...fields('new word'),deck:'New deck'},now);
  await mac.commit({...mac.library,cards:[...mac.library.cards,added]},{},[]);
  await answerCard(mac,2,3,now);
  await editAnswer(mac,2,'new word, corrected',now);
  let phone=await api.DropboxStore.open(cloud);
  assert.equal(phone.conflicts,0);
  assert.deepEqual(phone.library.cards,mac.library.cards);
  assert.equal(phone.library.cards[2].reviews.length,1);
  await answerCard(phone,0,3,now);                         // the phone saving must not set the new card aside
  await answerCard(mac,1,3,now);
  assert.equal(mac.library.cards.length,3);assert.equal(mac.conflicts,0);
  // deleted, then the same deck is added again (decks use fixed ids)
  await mac.commit({...mac.library,cards:mac.library.cards.filter(c=>c.id!==added.id)},{},[]);
  assert.equal((await stored(cloud)).cards.length,2);
  await mac.commit({...mac.library,cards:[...mac.library.cards,added]},{},[]);
  await answerCard(mac,2,4,now);
  phone=await api.DropboxStore.open(cloud);
  assert.equal(phone.conflicts,0);
  assert.deepEqual(phone.library.cards,mac.library.cards);
  assert.deepEqual(phone.library.cards[2].reviews.map(r=>r.rating),[4]);
  await mac._fold();
  assert.deepEqual((await stored(cloud)).cards,mac.library.cards);
  assert.equal(JSON.parse(await text(cloud,'/cards/library.json')).cards.length,3);
});

test('two clashes on the same card stay readable and are not repeated on every read',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(3,now));
  const oldAppRewrites=async rating=>{
    const before=await cloud.download('/cards/library.json'),file=JSON.parse(await before.text());
    file.cards[0]=rateCard(file.cards[0],rating,new Date(file.cards[0].schedule.due));file.revision++;
    await cloud.upload('/cards/library.json',JSON.stringify(file),{rev:before.metadata.rev});
  };
  let store=await api.DropboxStore.open(cloud);
  await answerCard(store,0,3,now);
  await oldAppRewrites(1);
  store=await api.DropboxStore.open(cloud);
  assert.equal(store.conflicts,1);
  await answerCard(store,0,3,new Date(store.library.cards[0].schedule.due));
  await oldAppRewrites(4);
  store=await api.DropboxStore.open(cloud);
  assert.equal(store.conflicts,2);
  await answerCard(store,1,3,now);                          // writes both clashes into journal.json
  for(let i=0;i<3;i++)store=await api.DropboxStore.open(cloud);
  assert.equal(store.conflicts,2);
  assert.equal(JSON.parse(await text(cloud,'/cards/journal.json')).conflicts.length,2);
  await answerCard(store,2,3,now);
  assert.equal(JSON.parse(await text(cloud,'/cards/journal.json')).conflicts.length,2);
  assert.deepEqual((await stored(cloud)).cards.map(c=>c.reviews.length),[2,1,1]);
});

test('answering the same few cards many times folds the journal before its history grows long',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=memoryCloud(manyCards(2,now));
  const store=await api.DropboxStore.open(cloud);
  let longest=0;
  for(let i=0;i<api.historyLimit*2+10;i++){
    await editAnswer(store,0,'version '+i,now);
    longest=Math.max(longest,...store.journal.entries.map(e=>e.parents.length));
  }
  assert.ok(longest<=api.historyLimit+1);
  const read=await api.DropboxStore.open(cloud);
  assert.equal(read.library.cards[0].answer,'version '+(api.historyLimit*2+9));
  assert.equal(read.conflicts,0);
});

test('another device answering between a rewrite of the library file and the emptying of the journal',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=hashingCloud(manyCards(api.journalLimit+5,now));
  const mac=await api.DropboxStore.open(cloud);
  for(let i=0;i<api.journalLimit;i++)await answerCard(mac,i,3,now);
  const phone=await api.DropboxStore.open(cloud);
  // the phone's answer lands after the mac has uploaded library.json and before it empties the journal
  const upload=cloud.upload.bind(cloud);let done=false;
  cloud.upload=async(path,...args)=>{
    const saved=await upload(path,...args);
    if(path==='/cards/library.json'&&!done){done=true;cloud.upload=upload;await answerCard(phone,api.journalLimit+1,4,now);}
    return saved;
  };
  await answerCard(mac,api.journalLimit,3,now);
  cloud.upload=upload;
  const read=await stored(cloud);
  assert.equal(read.cards.filter(c=>c.reviews.length).length,api.journalLimit+2);
  assert.equal(read.cards[api.journalLimit+1].reviews[0].rating,4);
  assert.equal((await api.DropboxStore.open(cloud)).conflicts,0);
  // both devices carry on from their own view without losing the other's answers
  await answerCard(mac,api.journalLimit+2,3,now);
  await answerCard(phone,api.journalLimit+3,3,now);
  const final=await stored(cloud);
  assert.equal(final.cards.filter(c=>c.reviews.length).length,api.journalLimit+4);
  assert.deepEqual(phone.library.cards,final.cards);
  assert.equal((await api.DropboxStore.open(cloud)).conflicts,0);
});

test('a damaged journal is reported instead of ignored, and a remembered file is still upgraded',async()=>{
  const now=new Date('2026-11-09T00:00:00Z'),cloud=memoryCloud(manyCards(2,now));
  const store=await api.DropboxStore.open(cloud);
  await answerCard(store,0,3,now);
  const good=cloud.files.get('/cards/journal.json');
  cloud.files.set('/cards/journal.json',new Blob(['{"format":"saymore-journal"']));
  await assert.rejects(api.DropboxStore.open(cloud),/journal\.json/);
  cloud.files.set('/cards/journal.json',good);
  const legacy=newLibrary(now),params=generatorParameters({request_retention:0.9,enable_fuzz:false});
  legacy.scheduler={name:'FSRS-6',implementation:'ts-fsrs',version:'5.4.2',params};legacy.cards=[newCard(fields('legacy'),now)];
  const old=hashingCloud(legacy);
  old.metadata=async path=>(await old.download(path))?.metadata||null;
  const first=await api.DropboxStore.open(old);
  const second=await api.DropboxStore.open(old,{raw:first.raw,rev:first.rev,hash:first.hash});
  assert.equal(second.upgrade,true);
  await answerCard(second,0,3,now);
  assert.equal(JSON.parse(await text(old,'/cards/library.json')).scheduler.policy.unknownRetry,'on-demand');
});

test('a save still succeeds when another device saved first',async()=>{
  assert.ok(api);
  const now=new Date('2026-11-09T00:00:00Z');
  const library=newLibrary(now);library.cards=[newCard(fields('one'),now),newCard(fields('two'),now)];
  const cloud=hashingCloud(library);
  const mine=await api.DropboxStore.open(cloud),theirs=await api.DropboxStore.open(cloud);
  const remote=copy(theirs.library);remote.cards[1]=rateCard(remote.cards[1],4,now);
  await theirs.commit(remote,{},[],undefined,{deferNotes:true});
  const local=copy(mine.library);local.cards[0]=rateCard(local.cards[0],3,now);
  await mine.commit(local,{},[],undefined,{deferNotes:true});
  assert.deepEqual(mine.library.cards.map(c=>c.reviews.length),[1,1]);
  assert.equal((await stored(cloud)).cards[1].reviews[0].rating,4);
  assert.deepEqual((await stored(cloud)).cards.map(c=>c.reviews.length),[1,1]);
});
