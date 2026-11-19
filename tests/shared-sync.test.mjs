import test from 'node:test';
import assert from 'node:assert/strict';

// Each simulated browser has its own storage; they share one fake Dropbox.
const store=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),m};};
const dropbox=()=>{
  const files=new Map();let n=0;
  return {connected:true,files,
    async download(path){const f=files.get(path);if(!f)return null;return {metadata:{rev:f.rev},text:async()=>f.text};},
    async upload(path,text,{rev=null}={}){const f=files.get(path);if((f?.rev||null)!==rev)throw Object.assign(Error('conflict'),{conflict:true});const next={text,rev:`r${++n}`};files.set(path,next);return {rev:next.rev};}};
};
const sync=await import('../static/saymore/shared/sync.mjs');
const as=(browser,fn)=>async(...args)=>{globalThis.localStorage=browser;return fn(...args);};

test('the newest change of each setting wins on every device, and values set before times were kept give way',async()=>{
  const cloud=dropbox(),phone=store(),mac=store();
  mac.setItem('saymore.cards.sort.v1','oldest');          // set long ago, no time recorded
  globalThis.localStorage=phone;sync.setSetting('saymore.cards.sort.v1','newest',new Date('2026-11-16T10:00:00Z'));
  assert.deepEqual(await as(phone,sync.syncSettings)(cloud),[]);
  assert.deepEqual(await as(mac,sync.syncSettings)(cloud),['saymore.cards.sort.v1']);
  assert.equal(mac.getItem('saymore.cards.sort.v1'),'newest');
  globalThis.localStorage=mac;sync.setSetting('saymore.cards.group.v1','level:B1',new Date('2026-11-16T11:00:00Z'));
  await as(mac,sync.syncSettings)(cloud);
  assert.deepEqual(await as(phone,sync.syncSettings)(cloud),['saymore.cards.group.v1']);
  assert.equal(phone.getItem('saymore.cards.group.v1'),'level:B1');
  // Nothing new: no upload.
  const rev=cloud.files.get('/settings.json').rev;
  await as(phone,sync.syncSettings)(cloud);
  assert.equal(cloud.files.get('/settings.json').rev,rev);
});

test('settings outside the shared list are never read from or written to Dropbox',async()=>{
  const cloud=dropbox(),a=store();
  a.setItem('saymore.dropbox.auth.v1','secret');
  globalThis.localStorage=a;sync.setSetting('saymore.cards.sort.v1','newest');
  await as(a,sync.syncSettings)(cloud);
  assert.ok(!cloud.files.get('/settings.json').text.includes('secret'));
  cloud.files.set('/settings.json',{rev:'x',text:JSON.stringify({format:'saymore-settings',version:1,items:{'saymore.dropbox.auth.v1':{value:'evil',at:'2030-01-01T00:00:00Z'}}})});
  await as(a,sync.syncSettings)(cloud);
  assert.equal(a.getItem('saymore.dropbox.auth.v1'),'secret');
});

test('listening counts of every browser add up, and each browser only replaces its own entry',async()=>{
  const cloud=dropbox(),phone=store(),mac=store();
  const own=n=>({'ship-sheep':{attempts:n,correct:n-1}});
  await as(phone,sync.syncListen)(cloud,own(10));
  const {others}=await as(mac,sync.syncListen)(cloud,own(4));
  assert.deepEqual(others,own(10));
  const back=await as(phone,sync.syncListen)(cloud,own(12));
  assert.deepEqual(back.others,own(4));
  // Storage here lost its counts but kept its id: the larger copy in Dropbox comes back and nothing shrinks.
  const restored=await as(phone,sync.syncListen)(cloud,{});
  assert.deepEqual(restored.own,own(12));
  globalThis.localStorage=phone;
  assert.deepEqual(sync.sumSets([own(12),sync.otherListenSets()]),{'ship-sheep':{attempts:16,correct:14}});
  assert.equal(Object.keys(JSON.parse(cloud.files.get('/listen-progress.json').text).devices).length,2);
});

test('a write that meets a write from another device reads again and keeps both',async()=>{
  const cloud=dropbox(),a=store(),b=store();
  const realUpload=cloud.upload.bind(cloud);let raced=false;
  cloud.upload=async(path,text,opts)=>{if(!raced&&path==='/settings.json'){raced=true;globalThis.localStorage=b;sync.setSetting('saymore.cards.sort.v1','oldest',new Date('2026-11-16T09:00:00Z'));await realUpload(path,JSON.stringify({format:'saymore-settings',version:1,items:{'saymore.cards.sort.v1':{value:'oldest',at:'2026-11-16T09:00:00.000Z'}}}),{rev:null});globalThis.localStorage=a;}return realUpload(path,text,opts);};
  globalThis.localStorage=a;sync.setSetting('saymore.skin','dracula',new Date('2026-11-16T10:00:00Z'));
  await as(a,sync.syncSettings)(cloud);
  const items=JSON.parse(cloud.files.get('/settings.json').text).items;
  assert.equal(items['saymore.skin'].value,'dracula');
  assert.equal(items['saymore.cards.sort.v1'].value,'oldest');
  assert.equal(a.getItem('saymore.cards.sort.v1'),'oldest');
});

test('a setting changed while the file is on its way is kept, and unknown items in the file survive',async()=>{
  const cloud=dropbox(),a=store();
  cloud.files.set('/settings.json',{rev:'r0',text:JSON.stringify({format:'saymore-settings',version:1,items:{'saymore.cards.group.v1':{value:'B',at:'2026-11-16T10:00:00Z'},'saymore.future.v9':{value:'x',at:'2026-11-16T10:00:00Z'}}})});
  globalThis.localStorage=a;sync.setSetting('saymore.cards.group.v1','A',new Date('2026-11-16T09:00:00Z'));
  const download=cloud.download.bind(cloud);let once=true;
  cloud.download=async path=>{const f=await download(path);if(once){once=false;sync.setSetting('saymore.cards.group.v1','C',new Date('2026-11-16T11:00:00Z'));}return f;};
  await as(a,sync.syncSettings)(cloud);
  assert.equal(a.getItem('saymore.cards.group.v1'),'C');
  const items=JSON.parse(cloud.files.get('/settings.json').text).items;
  assert.equal(items['saymore.cards.group.v1'].value,'C');
  assert.equal(items['saymore.future.v9'].value,'x');
});

test('a browser that cannot keep its id reads the other counts but never adds an entry',async()=>{
  const cloud=dropbox(),a=store();
  a.setItem=(k,v)=>{if(k==='saymore.device.v1')throw Error('quota');a.m.set(k,String(v));};
  const result=await as(a,sync.syncListen)(cloud,{'ship-sheep':{attempts:3,correct:2}});
  assert.deepEqual(result.others,{});
  assert.equal(cloud.files.get('/listen-progress.json'),undefined);
});

test('the old daily new-card limit written by an older page is kept in the file but never applied here',async()=>{
  const cloud=dropbox(),a=store();
  cloud.files.set('/settings.json',{rev:'r0',text:JSON.stringify({format:'saymore-settings',version:1,items:{'saymore.cards.new-per-day.v1':{value:'10',at:'2030-01-01T00:00:00Z'}}})});
  a.setItem('saymore.cards.new-per-day.v1','30');
  globalThis.localStorage=a;sync.setSetting('saymore.skin','dracula',new Date('2026-11-18T10:00:00Z'));
  assert.deepEqual(await as(a,sync.syncSettings)(cloud),[]);
  assert.equal(a.getItem('saymore.cards.new-per-day.v1'),'30','not taken over');
  assert.equal(sync.settingKeys.includes('saymore.cards.new-per-day.v1'),false);
  const items=JSON.parse(cloud.files.get('/settings.json').text).items;
  assert.equal(items['saymore.cards.new-per-day.v1'].value,'10','left untouched for older pages');
  assert.equal(items['saymore.skin'].value,'dracula');
});

test('the rated review mode of each tab is shared like the group',()=>{
  for(const s of ['','.form','.order'])assert.ok(sync.settingKeys.includes(`saymore.cards.review-mode${s}.v2`));
  for(const s of ['','.form','.order'])assert.ok(sync.settingKeys.includes(`saymore.cards.review-order${s}.v1`),'the order of 오늘 복습 too');
});
