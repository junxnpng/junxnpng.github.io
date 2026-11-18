import {editCard} from './model.mjs?v=9';
import {flagKinds} from './image-flag.mjs?v=6';

// A patch fills one empty attachment slot (image or audio) on cards that already exist.
// It never touches a card's schedule or review history, and replaces an attachment in one case only:
// a picture the reader marked as not fitting (see image-flag.mjs) or on a card never studied, when the patch item says `replace`.
const kinds={
  image:{manifest:'images.json',format:'saymore-image-patch',list:'images',path:/^media\/[0-9a-f-]{36}\.(jpg|png|webp)$/,mimes:['image/jpeg','image/png','image/webp'],
    errors:{files:'이미지 묶음의 파일 구성을 확인해주세요.',format:'이미지 묶음 형식이 아닙니다.',item:'이미지 경로와 출처를 확인해주세요.',blob:'사용할 이미지 파일이 없거나 잘못되었습니다.'}},
  audio:{manifest:'audio.json',format:'saymore-audio-patch',list:'audio',path:/^media\/[0-9a-f-]{36}\.mp3$/,mimes:['audio/mpeg'],
    errors:{files:'녹음 묶음의 파일 구성을 확인해주세요.',format:'녹음 묶음 형식이 아닙니다.',item:'녹음 경로와 출처를 확인해주세요.',blob:'사용할 녹음 파일이 없거나 잘못되었습니다.'}},
};
const marks=[flagKinds.word.tag,flagKinds.sentence.tag];
const textManifest='text.json';
export const patchKind=files=>files.some(file=>file.path===textManifest)?'text':Object.keys(kinds).find(kind=>files.some(file=>file.path===kinds[kind].manifest))||'image';

const manifest=(text,message)=>{try{return JSON.parse(text);}catch{throw Error(message);}};

async function prepare(kind,library,files){
  const k=kinds[kind],entries=new Map(files.map(file=>[file.path,file.blob]));
  if(entries.size!==files.length||!entries.has(k.manifest)||entries.has(textManifest)||Object.values(kinds).some(other=>other!==k&&entries.has(other.manifest)))throw Error(k.errors.files);
  const patch=manifest(await entries.get(k.manifest).text(),k.errors.format);
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
    // A picture is replaced only when the patch asks to, and only where the reader marked it as not fitting
    // during review or has never studied the card, so a picture already tied to a memory is left alone.
    // The new picture goes in, any mark comes off, and the old file stays in the library folder.
    const swap=kind==='image'&&item.replace===true&&card.image&&card.image.path!==item.path&&(marks.some(tag=>card.tags.includes(tag))||card.reviews.length===0);
    // A recording patch may name the second slot: `slot:'word'` fills the example-word recording, beside the first.
    const field=kind==='audio'&&item.slot==='word'?'wordAudio':kind;
    if(item.slot!==undefined&&field===kind)throw Error(k.errors.item);
    if(card[field]&&!swap){skipped++;continue;}
    // Any mark about the picture is answered by the new one: "does not fit" on a swap, "no picture" on a fill.
    const tags=kind==='image'?card.tags.filter(tag=>tag!==flagKinds.missing.tag&&!(swap&&marks.includes(tag))):card.tags;
    replacements.set(card.id,editCard(card,{...card,tags,[field]:{path:item.path,credit:item.credit}}));
    uploads[item.path]=blob;
  }
  return {next:{...library,cards:library.cards.map(c=>replacements.get(c.id)||c)},uploads,ids:[...replacements.keys()],skipped};
}
export const prepareImagePatch=(library,files)=>prepare('image',library,files);
export const prepareAudioPatch=(library,files)=>prepare('audio',library,files);

// A text patch rewrites the wording of cards that already exist: front, answer, IPA, example, memory note and the
// sentence the device voice reads. Schedule, history, tags and attachments are never touched.
// Each item states the wording it expects to replace (`was`), so a card someone has edited since is refused, not overwritten.
const textFields=['front','answer','ipa','sentence','memory','speech'];
export async function prepareTextPatch(library,files){
  if(files.length!==1||files[0].path!==textManifest)throw Error('글 수정 묶음의 파일 구성을 확인해주세요.');
  const patch=manifest(await files[0].blob.text(),'글 수정 묶음 형식이 아닙니다.');
  if(patch.format!=='saymore-text-patch'||patch.version!==1||!Array.isArray(patch.cards)||!patch.cards.length)throw Error('글 수정 묶음 형식이 아닙니다.');
  const ids=new Set(),replacements=new Map();let skipped=0;
  for(const item of patch.cards){
    if(!item||ids.has(item.id))throw Error('중복된 카드가 있습니다.');
    ids.add(item.id);
    const card=library.cards.find(c=>c.id===item.id);
    // A card whose answer this patch already replaced is still recognised, so applying it twice changes nothing.
    if(!card||(card.answer!==item.answer&&card.answer!==item?.set?.answer))throw Error('카드 번호 또는 정답이 다릅니다. 저장하지 않았어요.');
    const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
    const names=plain(item.set)?Object.keys(item.set):[];
    if(!names.length||!plain(item.was)||names.length!==Object.keys(item.was).length||names.some(name=>!textFields.includes(name)||typeof item.set[name]!=='string'||typeof item.was[name]!=='string'||item.set[name]!==item.set[name].trim()))throw Error('바꿀 내용을 확인해주세요.');
    if(names.every(name=>card[name]===item.set[name])){skipped++;continue;}
    // A recording says the old sentence; replacing the sentence under it would leave the two disagreeing.
    if((card.audio||card.wordAudio)&&names.includes('answer'))throw Error(`‘${card.answer}’ 카드에는 녹음이 붙어 있어 정답을 바꿀 수 없어요. 저장하지 않았어요.`);
    if(names.some(name=>card[name]!==item.was[name]&&card[name]!==item.set[name]))throw Error(`‘${card.answer}’ 카드는 그사이 내용이 바뀌었어요. 저장하지 않았어요.`);
    replacements.set(card.id,editCard(card,{...card,...Object.fromEntries(names.map(name=>[name,item.set[name]]))}));
  }
  return {next:{...library,cards:library.cards.map(c=>replacements.get(c.id)||c)},uploads:{},ids:[...replacements.keys()],skipped};
}
