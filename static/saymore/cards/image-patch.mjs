import {editCard} from './model.mjs?v=5';

// A patch fills one empty attachment slot (image or audio) on cards that already exist.
// It never replaces an attachment and never touches a card's schedule or review history.
const kinds={
  image:{manifest:'images.json',format:'saymore-image-patch',list:'images',path:/^media\/[0-9a-f-]{36}\.(jpg|png|webp)$/,mimes:['image/jpeg','image/png','image/webp'],
    errors:{files:'이미지 묶음의 파일 구성을 확인해주세요.',format:'이미지 묶음 형식이 아닙니다.',item:'이미지 경로와 출처를 확인해주세요.',blob:'사용할 이미지 파일이 없거나 잘못되었습니다.'}},
  audio:{manifest:'audio.json',format:'saymore-audio-patch',list:'audio',path:/^media\/[0-9a-f-]{36}\.mp3$/,mimes:['audio/mpeg'],
    errors:{files:'녹음 묶음의 파일 구성을 확인해주세요.',format:'녹음 묶음 형식이 아닙니다.',item:'녹음 경로와 출처를 확인해주세요.',blob:'사용할 녹음 파일이 없거나 잘못되었습니다.'}},
};
export const patchKind=files=>Object.keys(kinds).find(kind=>files.some(file=>file.path===kinds[kind].manifest))||'image';

async function prepare(kind,library,files){
  const k=kinds[kind],entries=new Map(files.map(file=>[file.path,file.blob]));
  if(entries.size!==files.length||!entries.has(k.manifest)||Object.values(kinds).some(other=>other!==k&&entries.has(other.manifest)))throw Error(k.errors.files);
  const patch=JSON.parse(await entries.get(k.manifest).text());
  if(patch.format!==k.format||patch.version!==1||!Array.isArray(patch[k.list])||!patch[k.list].length)throw Error(k.errors.format);
  const ids=new Set(),paths=new Set(),uploads={},replacements=new Map();let skipped=0;
  for(const item of patch[k.list]){
    if(!item||ids.has(item.id))throw Error('중복된 카드가 있습니다.');
    ids.add(item.id);
    const card=library.cards.find(c=>c.id===item.id);
    if(!card||card.answer!==item.answer)throw Error('카드 번호 또는 정답이 다릅니다. 저장하지 않았어요.');
    if(typeof item.path!=='string'||!k.path.test(item.path)||paths.has(item.path)||typeof item.credit!=='string'||!item.credit.trim()||item.credit.length>1000)throw Error(k.errors.item);
    paths.add(item.path);
    const blob=entries.get(item.path);
    if(!(blob instanceof Blob)||!blob.size||blob.size>10*1024*1024||!k.mimes.includes(blob.type))throw Error(k.errors.blob);
    if(card[kind]){skipped++;continue;}
    replacements.set(card.id,editCard(card,{...card,[kind]:{path:item.path,credit:item.credit}}));
    uploads[item.path]=blob;
  }
  return {next:{...library,cards:library.cards.map(c=>replacements.get(c.id)||c)},uploads,ids:[...replacements.keys()],skipped};
}
export const prepareImagePatch=(library,files)=>prepare('image',library,files);
export const prepareAudioPatch=(library,files)=>prepare('audio',library,files);
