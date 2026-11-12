// "This picture does not fit the word" is kept as an ordinary tag, so flagged cards can be searched,
// show up in the notes, and travel with every backup. Flagging changes nothing else on the card:
// the schedule and the review history are carried over as they are.
export const imageFlagTag='그림교체';
export const hasImageFlag=card=>card.tags.includes(imageFlagTag);
export function flagImage(card,on,now=new Date()){
  const tags=card.tags.filter(tag=>tag!==imageFlagTag);
  if(on){
    if(tags.length>=30)throw Error('이 카드는 태그가 30개라 표시를 더할 수 없어요. 태그를 하나 지운 뒤 다시 눌러주세요.');
    tags.push(imageFlagTag);
  }
  return {...JSON.parse(JSON.stringify(card)),tags,updatedAt:now.toISOString()};
}
