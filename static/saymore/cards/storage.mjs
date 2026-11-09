import {copy, newLibrary, parseLibrary, renderNote} from './model.mjs?v=2';

const stateFile = 'library.json';
const mediaPattern = /^media\/[0-9a-f-]{36}\.(jpg|png|webp|mp3)$/;
const conflict = () => Error('다른 창이나 앱에서 보관함이 바뀌었어요. 덮어쓰지 않았습니다. 저장된 내용 다시 읽기를 눌러주세요.');

async function handle(dir, path, create = false) {
  const parts = path.split('/');
  if (parts.length > 2 || parts.some(p=>!p || p === '.' || p === '..' || p.includes('\\'))) throw Error('허용하지 않는 파일 경로입니다.');
  if (parts.length === 2) dir = await dir.getDirectoryHandle(parts.shift(), {create});
  return dir.getFileHandle(parts[0], {create});
}

export async function readText(dir, path) {
  try {
    const file = await (await handle(dir,path)).getFile();
    if (file.size > 50*1024*1024) throw Error('파일이 너무 큽니다. 저장 폴더를 확인해주세요.');
    return await file.text();
  } catch (e) { if (e.name === 'NotFoundError') return null; throw e; }
}

export async function writeFile(dir, path, data) {
  const stream = await (await handle(dir,path,true)).createWritable({mode:'exclusive'});
  try { await stream.write(data); await stream.close(); }
  catch (e) { try { await stream.abort(); } catch {} throw e; }
}

async function empty(dir) {
  for await (const entry of dir.values()) return false;
  return true;
}

async function collectionFolder(selected) {
  if (await readText(selected,stateFile) !== null) return selected;
  const parent = selected.name === '카드' ? null : selected.name === 'SayMore' ? selected : await selected.getDirectoryHandle('SayMore',{create:true});
  const dir = parent ? await parent.getDirectoryHandle('카드',{create:true}) : selected;
  if (await readText(dir,stateFile) === null && !await empty(dir)) throw Error('카드 폴더에 다른 파일이 있어요. 비어 있는 보관함 폴더를 선택해주세요.');
  return dir;
}

async function locked(fn) {
  if (!navigator.locks) throw Error('안전한 폴더 저장을 지원하는 최신 Chrome 또는 Edge를 사용해주세요.');
  return navigator.locks.request('saymore-library-write', fn);
}

export class FolderStore {
  constructor(folder, library, raw) { this.folder=folder; this.library=library; this.raw=raw; }

  static async open(selected) {
    const folder = await collectionFolder(selected);
    const raw = await readText(folder,stateFile);
    const store = new FolderStore(folder,raw === null ? newLibrary() : parseLibrary(raw),raw);
    if (raw === null) await store.commit(store.library,{},[]);
    return store;
  }

  async readMedia(path) {
    if (!mediaPattern.test(path)) throw Error('첨부파일 경로를 확인해주세요.');
    const file = await (await handle(this.folder,path)).getFile();
    if (!file.size || file.size > 10*1024*1024) throw Error('첨부파일은 0바이트보다 크고 10MB 이하여야 해요.');
    return new Blob([await file.arrayBuffer()],{type:file.type});
  }

  async commit(next, uploads = {}, changedIds = []) {
    return locked(async () => {
      if (next.id !== this.library.id || next.revision !== this.library.revision) throw conflict();
      if (await readText(this.folder,stateFile) !== this.raw) throw conflict();
      const snapshot = parseLibrary(JSON.stringify({...copy(next), revision:next.revision+1, updatedAt:new Date().toISOString()}));
      const refs = new Set(snapshot.cards.flatMap(c=>[c.image?.path,c.audio?.path].filter(Boolean)));
      for (const [path,blob] of Object.entries(uploads)) {
        if (!refs.has(path) || !mediaPattern.test(path) || !(blob instanceof Blob) || !blob.size || blob.size > 10*1024*1024) throw Error('저장할 첨부파일을 확인해주세요.');
      }
      // Hold one exclusive canonical writer while preparing the commit.
      const file = await handle(this.folder,stateFile,true);
      const writer = await file.createWritable({keepExistingData:true,mode:'exclusive'});
      let committed = false;
      try {
        const current = await (await file.getFile()).text();
        if (current !== (this.raw ?? '')) throw conflict();
        for (const [path,blob] of Object.entries(uploads)) {
          let existing;
          try { existing=await (await handle(this.folder,path)).getFile(); }
          catch(e) { if(e.name !== 'NotFoundError') throw e; }
          if (existing) {
            const [left,right] = await Promise.all([existing.arrayBuffer(),blob.arrayBuffer()]);
            if (left.byteLength !== right.byteLength || !new Uint8Array(left).every((b,i)=>b===new Uint8Array(right)[i])) throw Error('같은 이름의 첨부파일이 이미 있어요. 파일을 다시 선택해주세요.');
          } else await writeFile(this.folder,path,blob);
        }
        for (const path of refs) {
          const media = await (await handle(this.folder,path)).getFile();
          if (!media.size || media.size > 10*1024*1024) throw Error('첨부파일이 없거나 너무 큽니다. 다시 선택해주세요.');
        }
        if (this.raw !== null) {
          const backup = await readText(this.folder,'library.backup.json');
          if (backup !== null) parseLibrary(backup);
          await writeFile(this.folder,'library.backup.json',this.raw);
        }
        // Re-check external edits before replacing the snapshot.
        if (await readText(this.folder,stateFile) !== (this.raw ?? '')) throw conflict();
        const raw = JSON.stringify(snapshot,null,2)+'\n';
        await writer.truncate(0);
        await writer.write(raw);
        await writer.close();
        committed = true;
        this.library = snapshot;
        this.raw = raw;
      } catch (e) {
        if (!committed) try { await writer.abort(); } catch {}
        throw e;
      }
      return this._export(changedIds);
    });
  }

  async _export(ids) {
    const warnings=[];
    for (const id of new Set(ids)) {
      const card=this.library.cards.find(c=>c.id===id);
      if (!card) continue;
      try {
        const path=`notes/${id}.md`;
        const note=renderNote(card,await readText(this.folder,path) || '');
        await writeFile(this.folder,path,note);
      } catch(e) { warnings.push({id,message:e.message}); }
    }
    return {warnings};
  }

  async exportNotes() {
    return locked(async()=>{
      if (await readText(this.folder,stateFile) !== this.raw) throw conflict();
      return this._export(this.library.cards.map(c=>c.id));
    });
  }
}

// Only the directory handle is cached here. Card data always comes from the folder.
export function rememberedFolder(value) {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('saymore-folders',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('handles');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result;
      const tx=db.transaction('handles',value ? 'readwrite':'readonly');
      const store=tx.objectStore('handles');
      const operation=value ? store.put(value,'cards') : store.get('cards');
      let result=null;
      operation.onsuccess=()=>{result=operation.result;};
      tx.oncomplete=()=>{db.close();resolve(result);};
      tx.onerror=()=>{db.close();reject(tx.error);};
      tx.onabort=()=>{db.close();reject(tx.error);};
    };
  });
}

export function friendlyError(e) {
  if (e.name === 'AbortError') return '폴더 선택을 취소했어요. 입력한 내용은 화면에 남아 있어요.';
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return '폴더 쓰기 권한이 필요해요. 폴더를 다시 연결해주세요. 저장 전의 입력은 화면에 남아 있어요.';
  if (e.name === 'NoModificationAllowedError') return '다른 창에서 파일을 저장 중이에요. 잠시 뒤 다시 저장해주세요.';
  if (e.name === 'NotFoundError') return '필요한 파일이나 폴더가 없어요. 폴더 위치와 첨부파일을 확인해주세요.';
  return e.message || '저장하지 못했어요. 폴더의 권한과 남은 공간을 확인해주세요.';
}
