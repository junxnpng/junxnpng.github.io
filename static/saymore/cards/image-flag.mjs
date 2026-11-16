// "This picture does not fit" and "this card has no picture" marks, made during review on the back of a card. Each kind is kept as an ordinary tag, so marked
// cards can be searched, show up in the notes, and travel with every backup. Marking changes nothing
// else on the card: the schedule and the review history are carried over as they are.
export const flagKinds={
  word:{tag:'그림교체',off:'그림 ↔ 단어가 안 맞아요',on:'✓ 그림 ↔ 단어 안 맞음 · 취소',list:'그림 ↔ 단어 안 맞는 카드'},
  sentence:{tag:'문장불일치',off:'그림 ↔ 문장이 안 맞아요',on:'✓ 그림 ↔ 문장 안 맞음 · 취소',list:'그림 ↔ 문장 안 맞는 카드'},
  // For a card that has no picture at all: a request for one.
  missing:{tag:'그림없음',off:'그림이 없어요',on:'✓ 그림 없음 표시 · 취소',list:'그림 없는 카드'},
  // A word to make a memory for. Any way of choosing such words (a button on the back today, later perhaps
  // a count of 모름 answers or a pick from the summary) puts this tag on the card; the memory page lists them.
  remember:{tag:'REMEMBER',off:'따로 외울 단어로 표시',on:'✓ 따로 외울 단어 · 취소',list:'따로 외울 카드'},
  // Set when a memory is written on the memory page, so those cards can be listed together.
  linked:{tag:'MY-LINK',list:'내 기억을 적은 카드'}
};
// Marks that ask about the picture are offered on cards with a picture (or, for `missing`, without one).
export const pictureMark={word:true,sentence:true,missing:false};
export const memoryQuestion=answer=>`What does ${answer} remind you of?`;
// The memory is written in English or names, like the rest of the card.
export const hasHangul=text=>/[\u1100-\u11ff\u3130-\u318f\ua960-\ua97f\uac00-\ud7a3\ud7b0-\ud7ff\uffa0-\uffdc]/.test(text);
// Saving a memory moves the card from the "to remember" list to the "memory written" list.
export function memoryTags(card){
  const tags=card.tags.filter(t=>t!==flagKinds.remember.tag&&t!==flagKinds.linked.tag);
  if(tags.length>=30)throw Error('이 카드는 태그가 30개라 표시를 더할 수 없어요. 태그를 하나 지운 뒤 다시 저장해주세요.');
  return [...tags,flagKinds.linked.tag];
}
export const hasFlag=(card,kind)=>card.tags.includes(flagKinds[kind].tag);
export function setFlag(card,kind,on,now=new Date()){
  const {tag}=flagKinds[kind],tags=card.tags.filter(t=>t!==tag);
  if(on){
    if(tags.length>=30)throw Error('이 카드는 태그가 30개라 표시를 더할 수 없어요. 태그를 하나 지운 뒤 다시 눌러주세요.');
    tags.push(tag);
  }
  return {...JSON.parse(JSON.stringify(card)),tags,updatedAt:now.toISOString()};
}
