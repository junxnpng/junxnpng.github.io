// Settings and listening counts that each browser used to keep to itself, shared through Dropbox so the
// phone, the home-screen app and the computer agree. Two small files in the app folder:
//   /settings.json         one value per setting, each with the time it was last changed; the newest wins.
//   /listen-progress.json  listening counts per browser; every browser shows the sum of them all.

// The settings that follow the user from device to device. Values are kept as the strings localStorage holds.
export const settingKeys=['saymore.cards.new-per-day.v1','saymore.cards.sort.v1','saymore.skin','saymore.home.cards.v1',
  ...['','.form','.order'].flatMap(s=>[`saymore.cards.group${s}.v1`,`saymore.cards.practice-position${s}.v1`])];
const metaKey='saymore.settings.at.v1',settingsPath='/settings.json';
const epoch='1970-01-01T00:00:00.000Z';
const local={
  get(key){try{return localStorage.getItem(key);}catch{return null;}},
  set(key,value){try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{/* This visit keeps the value in memory only. */}},
};
const readMeta=()=>{try{const value=JSON.parse(local.get(metaKey)||'{}');return value&&typeof value==='object'?value:{};}catch{return {};}};

// Every change of a shared setting goes through here, so its time is known when devices are compared.
export function setSetting(key,value,now=new Date()){
  local.set(key,value);
  const meta=readMeta();meta[key]=now.toISOString();local.set(metaKey,JSON.stringify(meta));
}

const emptySettings=()=>({format:'saymore-settings',version:1,items:{}});
// Items this version does not know (written by a newer page, or malformed) are carried along untouched in
// `extra`, so an older copy of the site still open somewhere never deletes them.
export function parseSettings(text){
  const value=JSON.parse(text),state=emptySettings();state.extra={};
  if(value?.format!=='saymore-settings'||value.version!==1||!value.items||typeof value.items!=='object'||Array.isArray(value.items))throw Error('Say More 설정 파일이 아니에요.');
  for(const [key,item] of Object.entries(value.items)){
    const usable=settingKeys.includes(key)&&(typeof item?.value==='string'||item?.value===null)&&typeof item.at==='string'&&Number.isFinite(Date.parse(item.at))&&!(typeof item.value==='string'&&item.value.length>200000);
    if(usable)state.items[key]={value:item.value,at:new Date(item.at).toISOString()};else state.extra[key]=item;
  }
  return state;
}
// Newest time wins; on a tie the copy already in Dropbox stays, so two devices never swap values back and forth.
export function mergeSettings(remote,mine){
  const items={...remote.items};
  for(const [key,item] of Object.entries(mine.items))if(!items[key]||item.at>items[key].at)items[key]=item;
  return {...emptySettings(),items,extra:remote.extra||{}};
}
const fileText=state=>JSON.stringify({...emptySettings(),items:{...state.extra,...state.items}});
// What this browser holds. A value set before times were kept counts as the oldest possible change.
export function localSettings(){
  const meta=readMeta(),state=emptySettings();
  for(const key of settingKeys){
    const value=local.get(key);
    if(value===null&&!meta[key])continue;
    state.items[key]={value,at:meta[key]&&Number.isFinite(Date.parse(meta[key]))?new Date(meta[key]).toISOString():epoch};
  }
  return state;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// Reads the file, keeps the newest value of each setting here and there, and writes back only what this
// browser had newer. Returns the keys whose value in this browser changed.
export async function syncSettings(cloud){
  if(!cloud?.connected)return [];
  for(let attempt=0;attempt<6;attempt++){
    const mine=localSettings(),file=await cloud.download(settingsPath);
    const remote=file?parseSettings(await file.text()):{...emptySettings(),extra:{}};
    // A setting changed here while the file was on its way: start again from what this browser holds now.
    if(!same(localSettings(),mine))continue;
    const merged=mergeSettings(remote,mine);
    // Newer values from elsewhere are taken first, so a failed upload still leaves this browser up to date.
    const changed=[],meta=readMeta();
    for(const [key,item] of Object.entries(merged.items)){
      if(mine.items[key]&&same(mine.items[key],item))continue;
      if(local.get(key)!==item.value)changed.push(key);
      local.set(key,item.value);meta[key]=item.at;
    }
    local.set(metaKey,JSON.stringify(meta));
    if(file&&fileText(merged)===fileText(remote))return changed;
    try{await cloud.upload(settingsPath,fileText(merged),{rev:file?.metadata.rev||null});return changed;}
    catch(error){if(!error.conflict||attempt===5)throw error;}
  }
  return [];
}

// Listening counts. Each browser counts its own answers under its own id; the file holds every browser's
// counts, and what is shown is their sum. Adding instead of choosing the newest keeps every answer.
const deviceKey='saymore.device.v1',othersKey='saymore.listen.others.v1',listenPath='/listen-progress.json';
// null when this browser cannot keep an id: a new id on every visit would count the same answers again.
export function deviceId(){
  let id=local.get(deviceKey);
  if(!/^[a-z0-9-]{8,64}$/.test(id||'')){
    try{id=crypto.randomUUID();}catch{return null;}
    local.set(deviceKey,id);
  }
  return local.get(deviceKey)===id?id:null;
}
// Counts only grow, so the larger of two copies of one browser's counts is the right one.
export const maxSets=(a,b)=>{const out={...a};for(const [id,item] of Object.entries(b))if(!out[id]||item.attempts>out[id].attempts)out[id]=item;return out;};
const cleanSets=sets=>{
  const out={};
  if(!sets||typeof sets!=='object')return out;
  for(const [id,item] of Object.entries(sets))if(/^[a-z0-9-]{1,60}$/i.test(id)&&Number.isInteger(item?.attempts)&&Number.isInteger(item.correct)&&item.correct>=0&&item.correct<=item.attempts)out[id]={attempts:item.attempts,correct:item.correct};
  return out;
};
export function parseListen(text){
  const value=JSON.parse(text),devices={};
  if(value?.format!=='saymore-listen-devices'||value.version!==1||!value.devices||typeof value.devices!=='object')throw Error('Say More 듣기 기록 파일이 아니에요.');
  for(const [id,device] of Object.entries(value.devices))if(/^[a-z0-9-]{8,64}$/.test(id))devices[id]={sets:cleanSets(device?.sets),at:typeof device?.at==='string'?device.at:epoch};
  return {format:'saymore-listen-devices',version:1,devices};
}
export function sumSets(list){
  const out={};
  for(const sets of list)for(const [id,item] of Object.entries(sets)){const c=out[id]||{attempts:0,correct:0};out[id]={attempts:c.attempts+item.attempts,correct:c.correct+item.correct};}
  return out;
}
// The counts of every other browser, as last read from Dropbox. Pages add this browser's own counts to it.
export function otherListenSets(){try{return cleanSets(JSON.parse(local.get(othersKey)||'{}'));}catch{return {};}}
// Puts this browser's counts (`own`, the sets object of saymore.listen.v1) in the file and keeps the others here.
// Returns {others, own}: `own` may be larger than what was passed, if this browser's entry in Dropbox was.
export async function syncListen(cloud,own,{write=true}={}){
  if(!cloud?.connected)return null;
  const id=deviceId();
  for(let attempt=0;attempt<4;attempt++){
    const file=await cloud.download(listenPath);
    const state=file?parseListen(await file.text()):{format:'saymore-listen-devices',version:1,devices:{}};
    const others=sumSets(Object.entries(state.devices).filter(([key])=>key!==id).map(([,device])=>device.sets));
    local.set(othersKey,JSON.stringify(others));
    const mine=maxSets(cleanSets(own),id?state.devices[id]?.sets||{}:{});
    if(!write||!id||same(state.devices[id]?.sets||{},mine)||(!Object.keys(mine).length&&!state.devices[id]))return {others,own:mine};
    state.devices[id]={sets:mine,at:new Date().toISOString()};
    try{await cloud.upload(listenPath,JSON.stringify(state),{rev:file?.metadata.rev||null});return {others,own:mine};}
    catch(error){if(!error.conflict||attempt===3)throw error;}
  }
  return null;
}
