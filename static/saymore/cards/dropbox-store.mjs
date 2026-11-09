import {copy,newLibrary,parseLibrary,renderNote} from './model.mjs?v=3';
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
const bytesEqual=async(a,b)=>{
  const [left,right]=await Promise.all([a.arrayBuffer(),b.arrayBuffer()]);
  return left.byteLength===right.byteLength&&new Uint8Array(left).every((v,i)=>v===new Uint8Array(right)[i]);
};

export class DropboxStore{
  constructor(cloud,library,raw,rev){
    this.cloud=cloud;this.library=library;this.raw=raw;this.rev=rev;this.kind='dropbox';this.folder={name:'Dropbox'};this.writing=false;
    this.directoriesReady=null;this.preparedBackups=new Map();this.noteQueue=Promise.resolve();this.pendingNotes=0;
  }
  static async open(cloud){
    const file=await cloud.download(`${prefix}/library.json`);
    const raw=file?await file.text():null;
    return new DropboxStore(cloud,raw===null?newLibrary():parseLibrary(raw),raw,file?.metadata.rev||null);
  }
  directories(){
    if(!this.directoriesReady)this.directoriesReady=(async()=>{
      await this.cloud.mkdir(prefix);
      await Promise.all(['media','notes','backups'].map(name=>this.cloud.mkdir(`${prefix}/${name}`)));
    })().catch(error=>{this.directoriesReady=null;throw error;});
    return this.directoriesReady;
  }
  prepare(){return this._prepare(this.raw,this.rev);}
  async _prepare(raw,rev){
    await this.directories();
    if(raw===null)return;
    if(!this.preparedBackups.has(rev)){
      const ready=this.immutable(`backups/library-${rev}.json`,new Blob([raw])).catch(error=>{this.preparedBackups.delete(rev);throw error;});
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
  async commit(next,uploads={},changedIds=[],onProgress=()=>{},{deferNotes=false}={}){
    if(this.writing)throw Error('이 창에서 저장 중입니다. 잠시 기다려 주세요.');
    if(next.id!==this.library.id||next.revision!==this.library.revision)throw collision();
    this.writing=true;
    try{
      parseLibrary(JSON.stringify(next));
      const refs=new Set(next.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
      for(const [path,blob]of Object.entries(uploads))if(!refs.has(path)||!mediaPattern.test(path)||!(blob instanceof Blob)||!blob.size||blob.size>10*1024*1024)throw Error('저장할 첨부파일을 확인해 주세요.');
      await this.directories();
      let done=0;
      const total=Object.keys(uploads).length+new Set(changedIds).size;
      await eachLimited(Object.entries(uploads),async([path,blob])=>{await this.immutable(path,blob);onProgress(++done,total);});
      const oldRefs=new Set(this.library.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
      for(const path of refs)if(!oldRefs.has(path)&&!uploads[path])await this.readMedia(path);
      let raw=this.raw,rev=this.rev;
      for(let attempt=0;attempt<3;attempt++){
        const remote=raw===null?copy(this.library):parseLibrary(raw);
        const merged=mergeLibraries(this.library,next,remote);
        const snapshot=parseLibrary(JSON.stringify({...merged,revision:remote.revision+1,updatedAt:new Date().toISOString()}));
        await this._prepare(raw,rev);
        const newRaw=JSON.stringify(snapshot,null,2)+'\n';
        let saved;
        // Dropbox's revision check makes a separate read unnecessary unless another device wrote first.
        try{saved=await this.cloud.upload(`${prefix}/library.json`,newRaw,{rev});}
        catch(error){
          if(!error.conflict||attempt===2)throw error;
          const current=await this.cloud.download(`${prefix}/library.json`);
          raw=current?await current.text():null;rev=current?.metadata.rev||null;
          if(raw===null&&this.raw!==null)throw Error('Dropbox의 보관함 파일이 없어졌습니다. 기존 기록을 새 파일로 덮어쓰지 않았습니다.');
          continue;
        }
        this.library=snapshot;this.raw=newRaw;this.rev=saved.rev;
        this.preparedBackups.clear();
        const notes=this.queueNotes(changedIds,()=>onProgress(++done,total));
        return deferNotes?{warnings:[],notes}:await notes;
      }
    }finally{this.writing=false;}
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
    for(const path of refs)if(!entries.has(path)||entries.get(path).size>10*1024*1024)throw Error('새 덱의 첨부파일이 없거나 너무 큽니다. 기존 카드는 그대로 유지합니다.');
    if(!added.length)return {added:0,skipped:incoming.cards.length,warnings:[]};
    const uploads=Object.fromEntries([...refs].map(path=>[path,entries.get(path)]));
    const result=await this.commit({...copy(this.library),cards:[...copy(this.library.cards),...added]},uploads,added.map(c=>c.id),onProgress);
    const verified=await this.cloud.download(`${prefix}/library.json`);
    const readBack=verified&&parseLibrary(await verified.text());
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
    const remote=await this.cloud.download(`${prefix}/library.json`);
    if(remote){const existing=parseLibrary(await remote.text());if(existing.cards.length&&(!same(existing,library)))throw Error('Dropbox에 다른 카드 기록이 이미 있습니다. 가져오기로 덮어쓰지 않았습니다.');}
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
      const saved=await this.cloud.upload(`${prefix}/library.json`,raw,{rev:remote?.metadata.rev||null});
      // Read back the canonical bytes before telling the user migration succeeded.
      const verified=await this.cloud.download(`${prefix}/library.json`);
      if(!verified||!same(parseLibrary(await verified.text()),library))throw Error('업로드 후 보관함 검증을 마치지 못했습니다. 원본 폴더는 그대로 유지합니다.');
      this.library=library;this.raw=raw;this.rev=saved.rev;
      onProgress(entries.size,entries.size);
      return {cards:library.cards.length,files:entries.size};
    }finally{this.writing=false;}
  }
}
