// Keeps the last library.json this browser read, keyed by its Dropbox revision. When the file has not
// changed, opening the cards costs one small metadata request instead of a multi-megabyte download.
// The copy is only ever used when Dropbox reports the same revision, and is removed on disconnect.
const database='saymore-cards',table='snapshot',key='library';
function open(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(table);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function run(mode,action){
  const db=await open();
  try{
    return await new Promise((resolve,reject)=>{
      const request=action(db.transaction(table,mode).objectStore(table));
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  }finally{db.close();}
}
// Every failure (private mode, storage full, no IndexedDB) just means the file is downloaded as before.
export async function readSnapshot(){
  try{
    const saved=await run('readonly',store=>store.get(key));
    return saved&&typeof saved.raw==='string'&&typeof saved.rev==='string'?{raw:saved.raw,rev:saved.rev,hash:saved.hash||null}:null;
  }catch{return null;}
}
export async function writeSnapshot({raw,rev,hash=null}){
  try{await run('readwrite',store=>store.put({raw,rev,hash},key));}catch{/* opening downloads the file next time */}
}
export async function clearSnapshot(){
  try{await run('readwrite',store=>store.delete(key));}catch{/* nothing was kept */}
}
