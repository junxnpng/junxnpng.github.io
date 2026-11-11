import {editCard} from './model.mjs?v=4';

export async function prepareImagePatch(library, files) {
  const entries=new Map(files.map(file=>[file.path,file.blob]));
  if(entries.size!==files.length||!entries.has('images.json'))throw Error('이미지 묶음의 파일 구성을 확인해주세요.');
  const patch=JSON.parse(await entries.get('images.json').text());
  if(patch.format!=='saymore-image-patch'||patch.version!==1||!Array.isArray(patch.images)||!patch.images.length)throw Error('이미지 묶음 형식이 아닙니다.');
  const ids=new Set(),uploads={},replacements=new Map();let skipped=0;
  for(const item of patch.images){
    if(!item||ids.has(item.id))throw Error('중복된 카드가 있습니다.');
    ids.add(item.id);
    const card=library.cards.find(c=>c.id===item.id);
    if(!card||card.answer!==item.answer)throw Error('카드 번호 또는 정답이 다릅니다. 저장하지 않았어요.');
    if(!/^media\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(item.path)||typeof item.credit!=='string'||!item.credit.trim()||item.credit.length>1000)throw Error('이미지 경로와 출처를 확인해주세요.');
    const blob=entries.get(item.path);
    if(!(blob instanceof Blob)||!blob.size||blob.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(blob.type))throw Error('사용할 이미지 파일이 없거나 잘못되었습니다.');
    if(card.image){skipped++;continue;}
    replacements.set(card.id,editCard(card,{...card,image:{path:item.path,credit:item.credit}}));
    uploads[item.path]=blob;
  }
  return {next:{...library,cards:library.cards.map(c=>replacements.get(c.id)||c)},uploads,ids:[...replacements.keys()],skipped};
}
