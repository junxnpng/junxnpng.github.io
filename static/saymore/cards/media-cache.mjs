export class MediaCache{
  constructor(read){this.read=read;this.entries=new Map();}
  source(path){
    if(!this.entries.has(path)){
      const entry={url:null,promise:null};
      entry.promise=(async()=>{
        const blob=await this.read(path);
        if(this.entries.get(path)!==entry)throw new DOMException('첨부파일 읽기를 취소했어요.','AbortError');
        entry.url=URL.createObjectURL(blob);return entry.url;
      })().catch(error=>{if(this.entries.get(path)===entry)this.entries.delete(path);throw error;});
      this.entries.set(path,entry);
    }
    return this.entries.get(path).promise;
  }
  clear(){
    for(const entry of this.entries.values())if(entry.url)URL.revokeObjectURL(entry.url);
    this.entries.clear();
  }
}
