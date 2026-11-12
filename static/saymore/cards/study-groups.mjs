import {dueCards,unknownCards} from './model.mjs?v=5';
import {levels,cardLevel} from './levels.mjs?v=1';

const isWord=card=>card.tags.includes('FF625')||card.tags.includes('OX3000')||card.deck==='Fluent Forever · First 625';
const unlevelled='등급 밖';
const isIpa=card=>!isWord(card)&&(card.tags.includes('IPA')||/^IPA(?:\s|$)/i.test(card.deck));

export function studyGroups(cards){
  const groups=[{key:'all',label:'전체 카드',section:'전체',cards}];
  const ipa=cards.filter(isIpa),words=cards.filter(isWord);
  if(ipa.length){
    groups.push({key:'ipa',label:'IPA 전체',section:'IPA',cards:ipa});
    for(const deck of [...new Set(ipa.map(c=>c.deck))].sort())groups.push({key:`ipa-deck:${deck}`,label:deck,section:'IPA',cards:ipa.filter(c=>c.deck===deck)});
  }
  if(words.length){
    groups.push({key:'words',label:'단어 전체',section:'단어',cards:words});
    // One section per CEFR level, then 100-card batches inside it. Batches are cut from the library
    // order, which ratings and edits keep, so a card stays in the same batch on every device.
    for(const level of [...levels,unlevelled]){
      const list=words.filter(c=>(cardLevel(c)||unlevelled)===level);
      if(!list.length)continue;
      const section=level===unlevelled?'단어 · 등급 밖 (숫자·문법 용어 등)':`단어 · ${level}`;
      groups.push({key:`level:${level}`,label:`${level} 전체`,section,cards:list});
      if(list.length>100)for(let start=0;start<list.length;start+=100)groups.push({key:`level:${level}:${start/100+1}`,label:`${level} ${start+1}–${Math.min(start+100,list.length)}`,section,cards:list.slice(start,start+100)});
    }
  }
  const own=cards.filter(c=>!isIpa(c)&&!isWord(c));
  for(const deck of [...new Set(own.map(c=>c.deck))].sort())groups.push({key:`deck:${deck}`,label:deck,section:'내 덱',cards:own.filter(c=>c.deck===deck)});
  return groups;
}

export function cardsInGroup(cards,key){return studyGroups(cards).find(group=>group.key===key)?.cards||[];}

export function studyQueue(cards,key,mode='due',now=new Date()){
  const selected=cardsInGroup(cards,key);
  if(mode==='practice')return selected;
  if(mode==='unknown')return unknownCards({cards:selected});
  return dueCards({cards:selected},now);
}

export function studyProgress(cards,now=new Date()){
  const start=new Date(now);start.setHours(0,0,0,0);
  let remaining=0,completedToday=0;
  for(const card of cards){
    if(Date.parse(card.schedule.due)<=now.getTime()){remaining++;continue;}
    const reviewed=Date.parse(card.reviews.at(-1)?.at);
    if(reviewed>=start.getTime()&&reviewed<=now.getTime())completedToday++;
  }
  return {total:cards.length,remaining,completedToday,waiting:cards.length-remaining-completedToday};
}

export const sortOrders={default:'기본 순서',newest:'최근에 만든 순',oldest:'오래전에 만든 순',reviewedNewest:'최근에 복습한 순',reviewedOldest:'오래전에 복습한 순',dueSoonest:'복습 예정일 빠른 순'};
// Stable: ties keep the library order. Cards never reviewed go last in the review-based orders.
export function sortCards(cards,order='default'){
  const created=c=>Date.parse(c.createdAt),reviewed=c=>c.reviews.length?Date.parse(c.reviews.at(-1).at):null,due=c=>c.reviews.length?Date.parse(c.schedule.due):null;
  const by=(key,direction)=>(a,b)=>{const x=key(a),y=key(b);return x===null?(y===null?0:1):y===null?-1:direction*(x-y);};
  const compare={newest:by(created,-1),oldest:by(created,1),reviewedNewest:by(reviewed,-1),reviewedOldest:by(reviewed,1),dueSoonest:by(due,1)}[order];
  return compare?[...cards].sort(compare):cards;
}

// Where "이어서 연습" starts: the card last shown in this group. With no remembered card (first use,
// another device, or the card is gone) it continues after what has been studied: the first card
// that has never been reviewed, or the start when every card has been.
export function resumeIndex(cards,savedId){
  const saved=savedId?cards.findIndex(c=>c.id===savedId):-1;
  if(saved>=0)return saved;
  const fresh=cards.findIndex(c=>!c.reviews.length);
  return fresh<0?0:fresh;
}
