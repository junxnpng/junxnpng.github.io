// "This picture does not fit" marks, made during review. Each kind is kept as an ordinary tag, so marked
// cards can be searched, show up in the notes, and travel with every backup. Marking changes nothing
// else on the card: the schedule and the review history are carried over as they are.
export const flagKinds={
  word:{tag:'그림교체',off:'그림 ↔ 단어가 안 맞아요',on:'✓ 그림 ↔ 단어 안 맞음 · 취소',list:'그림 ↔ 단어 안 맞는 카드'},
  sentence:{tag:'문장불일치',off:'그림 ↔ 문장이 안 맞아요',on:'✓ 그림 ↔ 문장 안 맞음 · 취소',list:'그림 ↔ 문장 안 맞는 카드'}
};
export const hasFlag=(card,kind)=>card.tags.includes(flagKinds[kind].tag);
export function setFlag(card,kind,on,now=new Date()){
  const {tag}=flagKinds[kind],tags=card.tags.filter(t=>t!==tag);
  if(on){
    if(tags.length>=30)throw Error('이 카드는 태그가 30개라 표시를 더할 수 없어요. 태그를 하나 지운 뒤 다시 눌러주세요.');
    tags.push(tag);
  }
  return {...JSON.parse(JSON.stringify(card)),tags,updatedAt:now.toISOString()};
}
